import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen bg-linear-to-b from-neutral-50 to-white">
      <section className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 text-center">
        <h1 className="mb-4 text-4xl font-bold leading-tight text-neutral-900 md:text-5xl">
          Your team's tasks, attendance and chat in one place
        </h1>
        <p className="mb-8 text-base text-neutral-600 md:text-lg">
          Pandav helps teams assign work, track attendance and talk in real time, with admin approvals built in.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/login"
            className="rounded-lg bg-neutral-900 px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
          >
            Login
          </Link>
          <Link
            to="/about"
            className="rounded-lg border border-neutral-300 px-8 py-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Learn more
          </Link>
        </div>
      </section>
    </div>
  );
}
