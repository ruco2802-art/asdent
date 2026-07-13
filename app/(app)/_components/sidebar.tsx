"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseSimple,
  CalendarBlank,
  ChatDots,
  Sliders,
  Plugs,
  SignOut,
} from "@phosphor-icons/react";
import { signOutAction } from "@/lib/actions/auth";

type PhosphorIcon = React.ComponentType<{
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}>;

interface NavItem {
  href: string;
  label: string;
  Icon: PhosphorIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", Icon: HouseSimple },
  { href: "/citas", label: "Citas", Icon: CalendarBlank },
  { href: "/conversaciones", label: "Conversaciones", Icon: ChatDots },
  { href: "/personalizacion", label: "Personalización", Icon: Sliders },
  { href: "/integraciones", label: "Integraciones", Icon: Plugs },
];

interface SidebarProps {
  orgName: string;
  userName: string;
  userEmail: string;
}

export function Sidebar({ orgName, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();

  const displayName = userName || userEmail;
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-stone-50 border-r border-stone-200 h-full">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-stone-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático, sin next/image en el resto del proyecto */}
        <img src="/asdent-logo.svg" alt="ASDent" className="h-7 w-auto" />
        <p className="mt-1.5 text-xs text-stone-400 truncate">{orgName}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-teal-50 text-teal-700"
                  : "text-slate-600 hover:bg-stone-100 hover:text-slate-900",
              ].join(" ")}
            >
              <Icon
                size={18}
                weight={active ? "fill" : "regular"}
                className={active ? "text-teal-700" : "text-stone-400"}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-stone-200">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-teal-700 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0 select-none">
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate leading-tight">
              {userName || userEmail}
            </p>
            {userName && (
              <p className="text-xs text-stone-400 truncate leading-tight mt-0.5">
                {userEmail}
              </p>
            )}
          </div>
        </div>
        <form action={signOutAction} className="mt-1">
          <button
            type="submit"
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-stone-500 hover:bg-red-50 hover:text-red-600 transition-colors group"
          >
            <SignOut
              size={18}
              className="text-stone-400 group-hover:text-red-500 transition-colors"
            />
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
