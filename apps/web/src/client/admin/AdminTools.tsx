// Nick's internal tools, linked from the game's menu when he's signed in as the admin (a closed
// "Tools" list, so it stays out of the way). Each opens in this tab; back returns to the game.
import "./admin-tools.css";

const TOOLS: { href: string; name: string; what: string }[] = [
  { href: "/admin/lab", name: "Relief lab", what: "Training runs from the Mac, live" },
  { href: "/tools/relief", name: "Relief editor", what: "Paint which way each pixel faces" },
  { href: "/admin/errors", name: "Crash reports", what: "Errors from every device playing" },
  { href: "/explore", name: "ROM explorer", what: "Disassembly, step debugger, assets" },
  { href: "/dev/dex", name: "Pokédex looks", what: "The Pokédex designs side by side" },
  { href: "/dev/menu/live", name: "Pokédex menu, live", what: "The menu in the real game" },
  { href: "/dev/battle", name: "Battle", what: "Battle scene preview" },
  { href: "/dev/emu", name: "Emulator debugger", what: "Registers, memory, breakpoints" },
];

export function AdminTools() {
  return (
    <details className="admin-tools">
      <summary>Tools</summary>
      <ul>
        {TOOLS.map((t) => (
          <li key={t.href}><a href={t.href}><span className="name">{t.name}</span><span className="what">{t.what}</span></a></li>
        ))}
      </ul>
    </details>
  );
}
