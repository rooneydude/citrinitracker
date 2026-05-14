import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Citrini Tracker</h1>
          <p className="text-foreground/40 text-sm mt-1">
            Sign in to access your rebalancer
          </p>
        </div>

        <form className="space-y-4 bg-card rounded-2xl border border-card-border p-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-semibold text-foreground/70 mb-2"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full bg-background border border-card-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-foreground/70 mb-2"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              className="w-full bg-background border border-card-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
            />
          </div>

          {error ? (
            <p className="text-red text-sm bg-red-dim border border-red/30 rounded-lg px-3 py-2">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="text-accent text-sm bg-accent-dim border border-accent/30 rounded-lg px-3 py-2">
              {message}
            </p>
          ) : null}

          <button
            formAction={login}
            className="w-full py-3 px-4 bg-accent text-background font-bold rounded-xl text-sm hover:bg-accent/80 transition"
          >
            Log in
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-card-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card px-3 text-foreground/30 text-xs uppercase">
                or
              </span>
            </div>
          </div>

          <button
            formAction={signup}
            className="w-full py-3 px-4 bg-background border-2 border-accent text-accent font-bold rounded-xl text-sm hover:bg-accent-dim transition"
          >
            Create an account
          </button>
        </form>
      </div>
    </main>
  );
}
