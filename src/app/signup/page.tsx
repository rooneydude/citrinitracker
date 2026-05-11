import SignupForm from "./SignupForm";

export const metadata = { title: "Create account — Citrini Tracker" };

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <SignupForm />
    </main>
  );
}
