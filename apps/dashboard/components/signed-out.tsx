import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function SignedOut({ returnTo = "/dashboard" }: { returnTo?: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Your Nuni projects</CardTitle>
        <CardDescription>
          Sign in to manage the comments on sites you have claimed. Commenters
          never need an account.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <a
          className={buttonVariants({ size: "lg" })}
          href={`/dashboard/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Sign in to Nuni
        </a>
        <p className="text-xs text-muted-foreground">
          To claim a site, open it, click the Nuni button and choose
          &ldquo;Claim Nuni&rdquo;.
        </p>
      </CardContent>
    </Card>
  )
}
