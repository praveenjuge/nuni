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

export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
  return (
    <a
      {...props}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return
        e.preventDefault()
        history.pushState(null, "", props.href)
        window.dispatchEvent(new Event("app:navigate"))
      }}
    />
  )
}
