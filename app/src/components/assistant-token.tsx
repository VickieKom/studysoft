"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Status = { createdAt: string; lastUsedAt: string | null } | null;

const noChanges = () => () => {};
const fieldClass = "w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-small";

/** A date in the teacher's own browser time zone; the server does not know it. */
function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noChanges,
    () => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
    () => "",
  );
  return <time dateTime={iso}>{text}</time>;
}

/** The configuration the assistant's MCP client needs: where the server lives and the token. */
function configSnippet(token: string, origin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        studysoft: {
          command: "npx",
          args: ["tsx", "<путь к репозиторию>/mcp/src/server.ts"],
          env: { STUDYSOFT_URL: origin, STUDYSOFT_TOKEN: token },
        },
      },
    },
    null,
    2,
  );
}

/** Creating, showing once and revoking the assistant's token (#3). */
export function AssistantToken({ status }: { status: Status }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch {
      setError("Не получилось. Попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  const create = () =>
    run(async () => {
      const { token: created } = await routerClient.teacher.assistant.createToken.mutate();
      setToken(created);
    });
  const revoke = () =>
    run(async () => {
      await routerClient.teacher.assistant.revokeToken.mutate();
      setToken(null);
    });

  return (
    <div className="flex flex-col gap-4">
      {token ? (
        <div className="flex flex-col gap-3 rounded-card border border-green-300 bg-green-50 p-4">
          <p className="text-small font-semibold text-green-900">
            Скопируйте токен сейчас: после перезагрузки страницы его больше не будет видно.
          </p>
          <label htmlFor="assistant-token" className="text-small text-text-secondary">
            Токен ассистента
          </label>
          <input id="assistant-token" readOnly value={token} className={fieldClass} />
          <label htmlFor="assistant-config" className="text-small text-text-secondary">
            Настройка для ассистента
          </label>
          <textarea
            id="assistant-config"
            readOnly
            rows={12}
            value={configSnippet(token, window.location.origin)}
            className={fieldClass}
          />
        </div>
      ) : status ? (
        <p>
          Токен создан <LocalDate iso={status.createdAt} />.{" "}
          {status.lastUsedAt ? (
            <>
              Последнее использование: <LocalDate iso={status.lastUsedAt} />.
            </>
          ) : (
            "Ассистент им ещё не пользовался."
          )}
        </p>
      ) : (
        <p className="text-text-secondary">Токена нет: ассистент не подключён.</p>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={create} disabled={pending}>
          Создать токен
        </Button>
        {(status || token) && (
          <Button variant="secondary" onClick={revoke} disabled={pending}>
            Отозвать
          </Button>
        )}
      </div>
      {(status || token) && (
        <p className="text-small text-text-secondary">Новый токен сразу отключает предыдущий.</p>
      )}
    </div>
  );
}
