# p3-gifts-spike: can gifts land without a ROM patch?

Throwaway. Nothing here is imported by the app. No ROM, save or screenshot is committed.
The real feature (p3-gifts) lives in `packages/emu/src/gifts`; it settles a gift on the game's
save routines rather than on any battery RAM write ("What can go wrong" 1 below).

**Answer: yes.** A PC hook on `OverworldLoop` (D14) is enough. When the player is standing
still with no menu, text, script, battle or warp in progress, the hook makes the CPU *call the
game's own routines*, one after another, and then carries on with the overworld loop. Money,
items and Pokémon (party, and the box when the party is full) landed, survived the game's own
save and a reboot from the battery save, and gifts that don't fit waited without touching
anything. **D20** in `docs/DECISIONS.md` amends D12 accordingly; Nick approved it on 2026-10-07.

## Run it

```sh
git submodule update --init vendor/pokered && mise exec -- make -C vendor/pokered blue
pnpm rom:fetch
mise exec -- pnpm vitest run spikes/gifts
```

The test skips without `rom/pokeblue.gb` and `vendor/pokered/pokeblue.sym` (so it skips in CI).
It takes ~12 s on a cloud Xeon.

## How it works

`safepoint.ts` hooks `OverworldLoop` (00:03FF), the first instruction of the overworld's main
loop, which runs once or twice per frame while the player is in control. A queued job runs only
when `busyReason()` finds none of: a battle (`wIsInBattle`, `wCurOpponent`), a step in progress
(`wWalkCounter`), input locked by a script (`wJoyIgnore`), scripted or simulated movement
(`wStatusFlags5` bits 0, 5, 7; `wNPCMovementScriptPointerTableNum`), a ledge jump, fishing or
spin tile (`wMovementFlags` 6, 7), a pending warp (`wStatusFlags3` 3, `wStatusFlags6` 2–4 and 6,
`wStatusFlags7` 2), a link (`wStatusFlags4` 6) or the Safari Zone ending. Text boxes and menus
never reach the loop at all: `DisplayTextID` only returns once they're closed.

Each step is a real `call`: the hook pushes `OverworldLoop` as the return address, sets the
routine's input registers and jumps to it. The routine's `ret` lands back on `OverworldLoop`,
the hook fires again, reads the result (usually the carry flag) and starts the next step. After
the last step it restores the registers and every scratch byte the job declared
(`wLoadedMon`, `wCurItem`, `hMoney`, …), and the loop continues as if nothing had happened.
The routines are home-bank entry points that switch ROM banks and switch back themselves
(`Predef`, `AddItemToInventory`, `AddEnemyMonToPlayerParty`, `Bankswitch`). This is the same
trick `packages/emu`'s `LinkPort` uses to send the core through `DelayFrame` (D17).

| gift | what runs | the game's own caller it copies |
|---|---|---|
| money | `Predef AddBCDPredef` (de = `wPlayerMoney`+2, hl = `hMoney`+2, c = 3) | Pay Day money after a battle |
| item | `AddItemToInventory` (hl = `wNumBagItems`, `wCurItem`, `wItemQuantity`) | `GiveItem` (NPC gifts) |
| Pokémon, party has room | the 44-byte struct into `wLoadedMon`, OT and nickname into `wEnemyMon1OT`/`Nick`, then `AddEnemyMonToPlayerParty` | the Trade Center, byte for byte |
| Pokémon, party full | **our writes:** append the first 33 bytes (box level set from the party level), OT and nickname to the current box; then `Predef IndexToPokedex` and two `Predef FlagActionPredef` for owned and seen | Bill's PC deposit (`_MoveMon` PARTY_TO_BOX) |

The box is the one case with no game routine that takes a ready-made Pokémon: the game's only
paths into a box are the PC (which moves a party mon) and `SendNewMonToBox` (which builds a
*new* mon from a wild battle's data and opens the naming screen). Going through the party with
the game's routines alone is possible (move party slot 6 to the box, add the gift, move it to
the box, move slot 6 back: seven calls), but the round trip recomputes the player's own slot-6
mon's level from its experience, so a mon whose level and experience disagree would change. A
56-byte append in the documented layout is the smaller risk.

## What was checked (`gifts.test.ts`)

- A "friend" Game Boy, renamed FRIEND with its own trainer ID, makes six Pokémon with the
  game's own `AddPartyMon` (random DVs, stats, moves) through the same safe point. Their 44-byte
  structs and OT names are the gifts, as a friend's client would send them.
- The receiver, in Red's room after a new game:
  - **A menu open:** a money gift queued while the start menu is up doesn't land; it lands as soon
    as B closes the menu.
  - **Mid-step:** an item gift queued while walking is held ("walking") and `AddItemToInventory`
    runs only with `wWalkCounter` 0.
  - **Items:** 98 Potions, then 5 more (the game fills the stack to 99 and starts a new one), then
    2 Antidotes.
  - **Pokémon:** six fill the party, a seventh goes to the box.
  - The scratch the trade routine reads from is back to what it was afterwards.
- The receiver saves with the game's own `SaveGameData` (what the start menu's SAVE calls),
  reboots from the battery save, presses through CONTINUE and finds: the money, the bag, all six
  party structs byte-identical with their OT and nickname, the boxed mon (33 bytes, OT, nickname)
  and six species owned in the Pokédex.
- **Doesn't fit:** with a full bag (20 kinds), a full party and box, and ¥999,000, a new item, an
  item whose stack would pass 99, a Pokémon and ¥1,000 all wait for 120 frames with the bag,
  party, box and money untouched. Once there's room (an item used, a mon withdrawn, money spent)
  all four land.
- `invalidMon` rejects a MissingNo. species and a malformed OT name before anything reaches the game.

Not checked with a real script: scripted events (Oak stopping you in Pallet Town, a trainer
walking up). They lock input or set the scripted-movement flags that `busyReason` reads, from
reading the source; a ROM test of one is cheap to add when this becomes real code.

## What can go wrong

1. **The gift isn't in the save until the player saves.** Exactly like an item picked up in
   the original. If they turn off without saving, it's gone from their game. So a gift can't be
   "delivered" when it lands; only when a save that contains it is written (`onSram` after the
   delivery). Until then the server keeps it pending and the client re-delivers it on the next
   boot. To avoid giving it twice (landed, saved, but the acknowledgement lost), the client keeps
   a ledger of applied gift IDs next to the save (and in the p1-saves-cloud copy).
2. **The sender's side is the same problem in reverse.** Taking the Pokémon, item or money out of
   the friend's game uses the game's own `RemovePokemon`, `RemoveItemFromInventory` and
   `SubBCDPredef` at their safe point, but it only sticks once they save. If the gift went out
   first and they reload an older save, they keep it *and* their friend gets it. The Cable Club
   solves this by making you save before a trade; D20 adopts the same rule for gifts.
3. **A full bag, party and box, or the money cap.** The gift waits (tested). The UI should say
   why ("make room in your bag"). The money check matters: the game's `AddBCD` saturates at
   ¥999,999, so without it a gift could silently lose money.
4. **A malformed or hacked Pokémon.** `invalidMon` checks species (no glitch slots), level and
   move IDs, and that both names are terminated. Stats aren't recomputed, so a struct edited to
   have impossible stats would land as sent. Friends-only, so the spike stops here; recomputing
   stats with the game's `CalcStats` is possible if Nick wants it.
5. **Game rules that apply as written.** A gifted Pokémon has the friend's OT and ID, so the game
   treats it like a traded one: 1.5× experience and the badge obedience limits. It doesn't
   evolve (that's the Trade Center's code, not `AddEnemyMonToPlayerParty`). **Key items** are
   accepted by `AddItemToInventory`, so gifting a Silph Scope, Card Key or Bicycle would skip
   story steps.
6. **RNG drift.** The calls take a few hundred cycles inside one frame, so later random numbers
   differ from a run without the gift, as they would after any different input. Not a fairness
   issue; noted because D1 promises the RNG is untouched (its *algorithm* is).

## Compared with a minimal mailbox patch (D12 as written)

A mailbox patch would replace OverworldLoop's first `call DelayFrame` with a call into new code
(ROM0 has 156 bytes free; banks 3, 1C and others have kilobytes) that checks a WRAM flag and, if
set, calls the same routines. Side by side:

| | PC hook (this spike) | mailbox patch |
|---|---|---|
| where the check runs | the first instruction of `OverworldLoop` | the same instruction |
| who writes the game state | the same routines, called with the same inputs | the same routines |
| how the gift gets in | JS writes the inputs at the hook | JS still writes the payload into WRAM (an emulator write); the patch only moves the "is it safe" check into asm |
| ROM change | none | ~100 bytes, shipped as a patch and applied in the browser (D7-safe), a second ROM hash to pin and test |
| free WRAM needed | none (scratch is saved and restored) | a few mailbox bytes outside the save that nothing else uses: WRAM0 has 30 unclaimed bytes, but they sit next to the stack |
| idle conditions | TypeScript, testable, changeable without a rebuild | assembly |
| depends on | SameBoy's per-instruction PC hooks (D14; also what D17 uses) | nothing in the emulator, so it'd work in any emulator (not a goal) |
| save-file effects | none beyond the gift | none beyond the gift: the patch lives in ROM, not SRAM |

Same safety (identical instruction boundary, identical routines), same save effects, and the
patch adds a modified ROM and a second toolchain to buy emulator independence we don't need.
The patch is still the fallback if a later core (binjgb on phones, D14's fallback) can't hook.
