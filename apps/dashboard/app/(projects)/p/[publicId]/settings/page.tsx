import type { Metadata } from "next"

import { ProjectSettings } from "@/components/project-settings"

export const metadata: Metadata = { title: "Project settings" }

export default function Page() {
  return <ProjectSettings />
}
