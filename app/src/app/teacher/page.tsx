import { redirect } from "next/navigation";

export default function TeacherHome() {
  redirect("/teacher/students");
}
