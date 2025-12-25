export default function Landing() {
  return (
    <div className="min-h-screen bg-linear-to-b from-neutral-50 to-white">
      <section className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 text-center">
        <h1 className="mb-4 text-4xl font-bold leading-tight text-neutral-900 md:text-5xl">
          your future is in your hand
        </h1>
        <p className="mb-8 text-base text-neutral-600 md:text-lg">
          Stop Whining and giving girly Excuses. Put your fingers on keyboard rather then use it to cover your dick and gf's ass
        </p>
        <a
          href="/login"
          className="rounded-lg bg-neutral-900 px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
        >
          Login
        </a>
      </section>
    </div>
  );
}
