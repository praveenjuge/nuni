import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

/** The Nuni mark and name, linking to the projects list. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex w-fit items-center gap-2 rounded-xl font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        className
      )}
    >
      <Image src="/dashboard/icon.svg" alt="" width={24} height={24} />
      Nuni
    </Link>
  )
}
