"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";

// The authentication library's sign-in endpoint (src/server/access/auth.ts).
const SIGN_IN_URL = "/api/auth/sign-in/email";

function messageFor(status: number): string {
  if (status === 401) return "Неверная почта или пароль";
  if (status === 429) return "Слишком много попыток. Подождите минуту и попробуйте снова";
  return "Не удалось войти. Попробуйте ещё раз";
}

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(SIGN_IN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (!response.ok) {
        setError(messageFor(response.status));
        return;
      }
      router.replace("/teacher/students");
      router.refresh();
    } catch {
      setError(messageFor(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1">
        <span className="text-small text-text-secondary">Электронная почта</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-10 rounded-control border border-border px-3 outline-none focus:border-green-500"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-small text-text-secondary">Пароль</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10 rounded-control border border-border px-3 outline-none focus:border-green-500"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        Войти
      </Button>
    </form>
  );
}
