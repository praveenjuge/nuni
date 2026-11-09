import { useEffect, useState, type AnchorHTMLAttributes } from "react"

export function usePath() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    window.addEventListener("popstate", update)
    window.addEventListener("app:navigate", update)
    return () => {
      window.removeEventListener("popstate", update)
      window.removeEventListener("app:navigate", update)
    }
  }, [])
  return path
}

/** Links keep the query, where the project and widget options live. */
export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
  const href = props.href + location.search
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return
        e.preventDefault()
        history.pushState(null, "", href)
        window.dispatchEvent(new Event("app:navigate"))
      }}
    />
  )
}
