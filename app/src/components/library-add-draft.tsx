"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

/** «Добавить в библиотеку» on the page of the assistant's draft (#120): from now on it is a regular material. */
export function LibraryAddDraft({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.library.addToLibrary.mutate({ id });
      router.refresh();
    } catch {
      setError("Не получилось добавить. Обновите страницу и попробуйте ещё раз");
    }
    setPending(false);
  }
  return (
    <>
      <Button disabled={pending} onClick={add}>
        Добавить в библиотеку
      </Button>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </>
  );
}
