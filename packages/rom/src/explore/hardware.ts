// Game Boy (DMG) memory map and I/O registers, with short explanations for the ROM explorer.
// Names follow hardware.inc, which the disassembly uses.

export interface Region {
  start: number;
  /** Inclusive. */
  end: number;
  name: string;
  short: string;
  about: string;
}

export const MEMORY_MAP: readonly Region[] = [
  {
    start: 0x0000,
    end: 0x3fff,
    name: "ROM bank 0",
    short: "ROM0",
    about:
      "The first 16 KB of the cartridge, always visible. Holds the interrupt and rst vectors, the header at $0100, and the \"home\" code every bank can call: bank switching, copying, the main loops.",
  },
  {
    start: 0x4000,
    end: 0x7fff,
    name: "Switchable ROM bank",
    short: "ROMX",
    about:
      "A 16 KB window onto any other bank of the cartridge. The game picks the bank by writing its number to $2000 (the MBC3 chip's register) and remembers it in hLoadedROMBank. This 1 MB ROM has 64 banks.",
  },
  {
    start: 0x8000,
    end: 0x9fff,
    name: "Video RAM",
    short: "VRAM",
    about:
      "8 KB inside the Game Boy for graphics: tile pixels at $8000–$97FF (384 tiles of 8×8, 16 bytes each) and two 32×32 tile maps at $9800 and $9C00 that say which tile goes where on the background and window.",
  },
  {
    start: 0xa000,
    end: 0xbfff,
    name: "Cartridge RAM",
    short: "SRAM",
    about:
      "Battery-backed RAM on the cartridge, in four 8 KB banks: this is where the save file lives. The game also borrows it as scratch space to decompress Pokémon pictures.",
  },
  {
    start: 0xc000,
    end: 0xdfff,
    name: "Work RAM",
    short: "WRAM",
    about:
      "8 KB of general RAM: the party, bag, map state, sprite state, the screen's tile buffer (wTileMap), and the stack at the top.",
  },
  { start: 0xe000, end: 0xfdff, name: "Echo RAM", short: "Echo", about: "A mirror of $C000–$DDFF. Nintendo said not to use it." },
  {
    start: 0xfe00,
    end: 0xfe9f,
    name: "Object attribute memory",
    short: "OAM",
    about: "40 hardware sprites, 4 bytes each: Y, X, tile number and flags. The game fills a copy in WRAM and DMA-copies it here every frame.",
  },
  { start: 0xfea0, end: 0xfeff, name: "Unusable", short: "—", about: "Not connected." },
  {
    start: 0xff00,
    end: 0xff7f,
    name: "I/O registers",
    short: "I/O",
    about: "Hardware control: buttons, the link cable, timer, sound and the screen (LCDC, scroll, palettes).",
  },
  {
    start: 0xff80,
    end: 0xfffe,
    name: "High RAM",
    short: "HRAM",
    about: "127 fast bytes that ldh can reach in 2 bytes. The game keeps hot variables here (hLoadedROMBank, joypad state) and runs the OAM DMA routine from it.",
  },
  { start: 0xffff, end: 0xffff, name: "Interrupt enable", short: "IE", about: "Which interrupts (VBlank, LCD, timer, serial, joypad) may fire." },
];

export function regionAt(address: number): Region {
  return MEMORY_MAP.find((r) => r.start <= address && address <= r.end)!;
}

export interface IoRegister {
  name: string;
  about: string;
}

export const IO_REGISTERS: Readonly<Record<number, IoRegister>> = {
  0xff00: { name: "rJOYP", about: "Joypad: select the buttons or the d-pad with bits 4–5, then read which are pressed (0 = pressed) in bits 0–3." },
  0xff01: { name: "rSB", about: "Serial data: the byte to send over the link cable, replaced by the received byte." },
  0xff02: { name: "rSC", about: "Serial control: start a transfer and choose the internal or external clock." },
  0xff04: { name: "rDIV", about: "Divider: counts up 16384 times a second. The game mixes it into its random numbers." },
  0xff05: { name: "rTIMA", about: "Timer counter: counts at the rate set in TAC and raises the timer interrupt on overflow." },
  0xff06: { name: "rTMA", about: "Timer modulo: TIMA reloads to this on overflow." },
  0xff07: { name: "rTAC", about: "Timer control: on/off and speed." },
  0xff0f: { name: "rIF", about: "Interrupt flags: which interrupts are waiting to be handled." },
  0xff10: { name: "rNR10", about: "Sound channel 1 sweep." },
  0xff11: { name: "rNR11", about: "Sound channel 1 duty and length." },
  0xff12: { name: "rNR12", about: "Sound channel 1 volume envelope." },
  0xff13: { name: "rNR13", about: "Sound channel 1 frequency, low bits." },
  0xff14: { name: "rNR14", about: "Sound channel 1 frequency high bits and trigger." },
  0xff16: { name: "rNR21", about: "Sound channel 2 duty and length." },
  0xff17: { name: "rNR22", about: "Sound channel 2 volume envelope." },
  0xff18: { name: "rNR23", about: "Sound channel 2 frequency, low bits." },
  0xff19: { name: "rNR24", about: "Sound channel 2 frequency high bits and trigger." },
  0xff1a: { name: "rNR30", about: "Sound channel 3 (wave) on/off." },
  0xff1b: { name: "rNR31", about: "Sound channel 3 length." },
  0xff1c: { name: "rNR32", about: "Sound channel 3 volume." },
  0xff1d: { name: "rNR33", about: "Sound channel 3 frequency, low bits." },
  0xff1e: { name: "rNR34", about: "Sound channel 3 frequency high bits and trigger." },
  0xff20: { name: "rNR41", about: "Sound channel 4 (noise) length." },
  0xff21: { name: "rNR42", about: "Sound channel 4 volume envelope." },
  0xff22: { name: "rNR43", about: "Sound channel 4 noise frequency and type." },
  0xff23: { name: "rNR44", about: "Sound channel 4 trigger." },
  0xff24: { name: "rNR50", about: "Master volume, left and right." },
  0xff25: { name: "rNR51", about: "Which sound channels go to the left and right speakers." },
  0xff26: { name: "rNR52", about: "Sound on/off and which channels are playing." },
  0xff40: { name: "rLCDC", about: "LCD control: screen on/off, which tile map and tile data the background and window use, sprites on/off and size." },
  0xff41: { name: "rSTAT", about: "LCD status: the current drawing mode and which events raise the LCD interrupt." },
  0xff42: { name: "rSCY", about: "Background scroll Y." },
  0xff43: { name: "rSCX", about: "Background scroll X." },
  0xff44: { name: "rLY", about: "The screen line being drawn now (0–153; 144 and up is VBlank)." },
  0xff45: { name: "rLYC", about: "Line compare: the LCD interrupt can fire when LY reaches this." },
  0xff46: { name: "rDMA", about: "Writing $XX copies $XX00–$XX9F into OAM. The game does this every frame to update sprites." },
  0xff47: { name: "rBGP", about: "Background palette: which of the 4 greys each colour number 0–3 shows as (2 bits each)." },
  0xff48: { name: "rOBP0", about: "Sprite palette 0." },
  0xff49: { name: "rOBP1", about: "Sprite palette 1." },
  0xff4a: { name: "rWY", about: "Window Y position. The game slides text boxes and menus in by moving the window." },
  0xff4b: { name: "rWX", about: "Window X position, plus 7." },
  0xff50: { name: "rBANK", about: "Writing here unmaps the boot ROM." },
  0xffff: { name: "rIE", about: "Interrupt enable: bit 0 VBlank, 1 LCD, 2 timer, 3 serial, 4 joypad." },
};

/** Memory-bank-controller registers: writes to ROM addresses talk to the MBC3 chip instead. */
export const MBC_REGISTERS: readonly Region[] = [
  { start: 0x0000, end: 0x1fff, name: "rRAMG", short: "RAMG", about: "Write $0A to enable cartridge RAM, $00 to protect it." },
  { start: 0x2000, end: 0x3fff, name: "rROMB", short: "ROMB", about: "Selects the ROM bank shown at $4000–$7FFF." },
  { start: 0x4000, end: 0x5fff, name: "rRAMB", short: "RAMB", about: "Selects the cartridge RAM bank (0–3) shown at $A000–$BFFF." },
  { start: 0x6000, end: 0x7fff, name: "rRTCLATCH", short: "RTC", about: "Real-time clock latch; this game doesn't use the clock." },
];

/** The fixed addresses at the start of ROM bank 0. */
export const VECTORS: Readonly<Record<number, string>> = {
  0x00: "rst $00",
  0x08: "rst $08",
  0x10: "rst $10",
  0x18: "rst $18",
  0x20: "rst $20",
  0x28: "rst $28",
  0x30: "rst $30",
  0x38: "rst $38",
  0x40: "VBlank interrupt: runs once per frame, when the screen finishes drawing",
  0x48: "LCD STAT interrupt",
  0x50: "Timer interrupt",
  0x58: "Serial interrupt: a link cable byte arrived",
  0x60: "Joypad interrupt",
  0x100: "Entry point: the boot ROM jumps here after the logo",
};
