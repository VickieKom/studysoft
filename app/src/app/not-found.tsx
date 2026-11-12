// One answer for anything that does not exist or is not yours: the same page,
// the same status (architecture 8.3).
export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-h2 font-bold">Страница не найдена</h1>
      <p className="text-text-secondary">Проверьте адрес или вернитесь к списку учеников</p>
    </main>
  );
}
