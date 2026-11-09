import Image from "next/image"
import Link from "next/link"

import { BASE_PATH } from "@/lib/config"

/** next/image doesn't add the basePath to a string `src`. */
export function NuniMark({ size }: { size: number }) {
  return (
    <Image src={`${BASE_PATH}/icon.svg`} alt="" width={size} height={size} />
  )
}

/** The Nuni mark and name, linking to the projects list. */
export function Logo() {
  return (
    <Link
      href="/"
      className="flex w-fit items-center gap-2 rounded-xl font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <NuniMark size={24} />
      Nuni
    </Link>
  )
}
