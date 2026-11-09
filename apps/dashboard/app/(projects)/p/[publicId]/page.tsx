import type { Metadata } from "next"

import { ProjectView } from "@/components/project-view"

export const metadata: Metadata = { title: "Project" }

export default function Page() {
  return <ProjectView />
}
