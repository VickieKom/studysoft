"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

/** «Удалить» on a material's page (#115). Nothing asks for confirmation, like the rest of the workspace. */
export function LibraryDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.library.remove.mutate({ id });
      router.push("/teacher/library");
      router.refresh();
    } catch {
      setError("Не получилось удалить. Обновите страницу и попробуйте ещё раз");
      setPending(false);
    }
  }
  return (
    <>
      <Button variant="secondary" disabled={pending} onClick={remove}>
        Удалить
      </Button>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </>
  );
}
