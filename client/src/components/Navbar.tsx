import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { useWalletContext } from "@/context/WalletContext";

interface DropdownItem {
  label: string;
  to?: string;
  href?: string;
  icon: string;
}

interface DropdownMenu {
  label: string;
  icon: string;
  items: DropdownItem[];
}

const MENUS: DropdownMenu[] = [
  {
    label: "Game",
    icon: ">>",
    items: [
      { label: "Overview", to: "/", icon: "//" },
      { label: "Races & Classes", to: "/races", icon: "**" },
      { label: "Story & Lore", to: "/story", icon: "<<" },
      { label: "Media", to: "/media", icon: "[]" },
      { label: "x402 Agent Deploy", to: "/x402", icon: "$>" },
    ],
  },
  {
    label: "Shop",
    icon: "$$",
    items: [
      { label: "NFT Marketplace", to: "/marketplace", icon: "$$" },
    ],
  },
  {
    label: "Community",
    icon: "##",
    items: [
      { label: "Leaderboards", to: "/leaderboards", icon: "##" },
      { label: "Discord", href: "https://discord.gg/worldofgeneva", icon: ">>" },
      { label: "News & Roadmap", to: "/news", icon: "!!" },
    ],
  },
];

function DropdownLink({
  item,
  onClick,
  isActive,
}: {
  item: DropdownItem;
  onClick: () => void;
  isActive: boolean;
}) {
  const baseClass = `flex items-center gap-2 px-4 py-2.5 text-[9px] uppercase tracking-wide transition ${
    isActive
      ? "bg-[#1e2842] text-[#ffcc00]"
      : "text-[#d6deff] hover:bg-[#1e2842] hover:text-[#ffcc00]"
  }`;

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass}
        onClick={onClick}
      >
        <span className="text-[8px] text-[#565f89]">{item.icon}</span>
        {item.label}
        <span className="ml-auto text-[7px] text-[#3a4260]">[ext]</span>
      </a>
    );
  }
  return (
    <Link to={item.to!} className={baseClass} onClick={onClick}>
      <span className={`text-[8px] ${isActive ? "text-[#ffcc00]" : "text-[#565f89]"}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export function Navbar(): React.ReactElement {
  const location = useLocation();
  const { isConnected, connect, loading, address, balance } = useWalletContext();
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const navRef = React.useRef<HTMLElement>(null);

  const isWorldRoute = location.pathname === "/world";

  // Close dropdown on outside click
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on route change
  React.useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [location.pathname]);

  const closeAll = () => {
    setOpenMenu(null);
    setMobileOpen(false);
  };

  // Check if any item in a menu group is active
  const isMenuActive = (menu: DropdownMenu) =>
    menu.items.some((item) => item.to && item.to === location.pathname);

  return (
    <nav
      ref={navRef}
      className={`fixed top-0 left-0 right-0 z-[60] border-b-2 transition-all duration-300 ${
        isWorldRoute
          ? "border-[#2a3450]/40 bg-[#0d1526]/70 backdrop-blur-md"
          : "border-[#2a3450] bg-[#0d1526]"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-0">
        {/* Logo */}
        <Link
          to="/"
          className="group flex items-center gap-2 py-2.5"
        >
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] text-[#ffcc00] transition group-hover:text-[#ffd84d]"
              style={{ textShadow: "1px 1px 0 #000" }}
            >
              {"//"}
            </span>
            <span
              className="text-[13px] uppercase tracking-[0.2em] text-[#ffcc00] transition group-hover:text-[#ffd84d]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              WoG
            </span>
            <span className="hidden text-[7px] text-[#565f89] sm:inline">
              World of Geneva
            </span>
          </div>
        </Link>

        {/* Desktop menu */}
        <div className="hidden items-center gap-0 md:flex">
          {MENUS.map((menu) => {
            const active = isMenuActive(menu);
            return (
              <div key={menu.label} className="relative">
                <button
                  className={`flex items-center gap-1 px-3 py-3 text-[9px] uppercase tracking-wide transition ${
                    openMenu === menu.label
                      ? "text-[#ffcc00]"
                      : active
                        ? "text-[#ffcc00]/80"
                        : "text-[#9aa7cc] hover:text-[#d6deff]"
                  }`}
                  onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                >
                  <span className="text-[7px]">{menu.icon}</span>
                  {menu.label}
                  <span className="text-[7px]">
                    {openMenu === menu.label ? "^" : "v"}
                  </span>
                </button>

                {/* Active indicator dot */}
                {active && !openMenu && (
                  <div className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 bg-[#ffcc00]" />
                )}

                {openMenu === menu.label && (
                  <div className="absolute left-0 top-full min-w-[180px] border-2 border-[#2a3450] bg-[#0d1526] shadow-[4px_4px_0_0_#000]">
                    <div className="border-b border-[#1e2842] px-4 py-1.5">
                      <span className="text-[7px] uppercase tracking-widest text-[#3a4260]">
                        {menu.label}
                      </span>
                    </div>
                    {menu.items.map((item) => (
                      <DropdownLink
                        key={item.label}
                        item={item}
                        onClick={closeAll}
                        isActive={item.to === location.pathname}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Docs link */}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-3 text-[9px] uppercase tracking-wide text-[#9aa7cc] transition hover:text-[#d6deff]"
          >
            <span className="text-[7px]">{">>>"}</span>
            Docs
          </a>

          {/* Divider */}
          <div className="mx-1 h-4 w-px bg-[#2a3450]" />

          {/* Spectate link */}
          <Link
            to="/world"
            className={`flex items-center gap-1.5 border-l border-[#2a3450] px-3 py-2 text-[9px] uppercase tracking-wide transition ${
              isWorldRoute
                ? "bg-[#112a1b] text-[#54f28b]"
                : "text-[#54f28b]/70 hover:text-[#54f28b]"
            }`}
          >
            <span className="inline-block animate-pulse text-[8px]">{">>>"}</span>
            Spectate
          </Link>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Wallet */}
          {!isConnected ? (
            <button
              onClick={() => void connect()}
              disabled={loading}
              className="border-2 border-[#ffcc00] bg-[#2a2210] px-3 py-1.5 text-[8px] uppercase tracking-wide text-[#ffcc00] shadow-[2px_2px_0_0_#000] transition hover:bg-[#3d3218] disabled:opacity-50"
            >
              {loading ? "..." : "Connect Wallet"}
            </button>
          ) : (
            <div className="flex items-center gap-0">
              {/* Gold balance */}
              {balance && (
                <div className="border-2 border-[#ffcc00]/40 border-r-0 bg-[#1a1800] px-2.5 py-1.5 text-[8px] text-[#ffcc00]">
                  <span className="mr-1 text-[7px] text-[#ffcc00]/60">GOLD</span>
                  {Number(balance.gold).toLocaleString()}
                </div>
              )}
              {/* Address */}
              <div className="border-2 border-[#54f28b]/40 bg-[#112a1b] px-2.5 py-1.5 text-[8px] text-[#54f28b]">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            className="flex flex-col gap-[3px] p-2 md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "translate-y-[5px] rotate-45" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-4 bg-[#9aa7cc] transition-all duration-200 ${
                mobileOpen ? "-translate-y-[5px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t-2 border-[#2a3450] bg-[#0d1526] pb-4 md:hidden">
          {MENUS.map((menu) => (
            <div key={menu.label} className="border-b border-[#1e2842]">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-[10px] uppercase tracking-wide text-[#9aa7cc]"
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[8px] text-[#565f89]">{menu.icon}</span>
                  {menu.label}
                </span>
                <span className="text-[8px]">{openMenu === menu.label ? "[-]" : "[+]"}</span>
              </button>
              {openMenu === menu.label && (
                <div className="border-t border-[#1e2842]/50 bg-[#0a0f1a] pb-2">
                  {menu.items.map((item) => (
                    <DropdownLink
                      key={item.label}
                      item={item}
                      onClick={closeAll}
                      isActive={item.to === location.pathname}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 px-4 pt-3">
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#9aa7cc] transition hover:text-[#d6deff]"
              onClick={closeAll}
            >
              <span className="text-[8px]">{">>>"}</span> Docs
            </a>
            <span className="text-[#2a3450]">|</span>
            <Link
              to="/world"
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#54f28b]"
              onClick={closeAll}
            >
              <span className="animate-pulse text-[8px]">{">>>"}</span> Spectate World
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
