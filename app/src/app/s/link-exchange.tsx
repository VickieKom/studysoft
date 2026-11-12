"use client";

import { useEffect, useState } from "react";
import { routerClient } from "@/components/router-client";

/**
 * Exchanges the token from the address fragment for a session (architecture
 * 8.1): the fragment never reaches a server log, and it is removed from the
 * address and the history once read.
 */
export function LinkExchange() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const run = async () => {
      const token = window.location.hash.slice(1);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (!token) {
        setGone(true);
        return;
      }
      try {
        await routerClient.links.exchange.mutate({ token });
        // A full load of the clean address: the session cookie is set now,
        // and the client router would put back the address it started with.
        window.location.replace(window.location.pathname + window.location.search);
      } catch {
        setGone(true);
      }
    };
    void run();
  }, []);

  if (gone) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-h2 font-bold">Ссылка больше не действует</h1>
        <p className="text-text-secondary">Попросите учителя прислать новую ссылку</p>
      </main>
    );
  }
  return (
    <p role="status" className="text-center text-text-secondary">
      Открываем…
    </p>
  );
}
