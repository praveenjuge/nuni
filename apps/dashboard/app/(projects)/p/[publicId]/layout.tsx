import { ProjectShell } from "@/components/project-shell"

export default async function Layout(props: LayoutProps<"/p/[publicId]">) {
  const { publicId } = await props.params
  return <ProjectShell publicId={publicId}>{props.children}</ProjectShell>
}
