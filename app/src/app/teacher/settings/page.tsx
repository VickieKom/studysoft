import { BriefTemplateEditor } from "@/components/brief-template-editor";
import { TeacherSettingsForm } from "@/components/teacher-settings-form";
import { teacherCaller } from "../caller";

export const metadata = { title: "Настройки — StudySoft" };

export default async function SettingsPage() {
  const { caller } = await teacherCaller();
  const { timeZone } = await caller.teacher.settings.get();
  const brief = await caller.teacher.requests.briefTemplate();
  return (
    <main className="flex max-w-md flex-col gap-6">
      <h1 className="text-h1 font-bold">Настройки</h1>
      <TeacherSettingsForm timeZone={timeZone} />
      <BriefTemplateEditor questions={brief} />
    </main>
  );
}
