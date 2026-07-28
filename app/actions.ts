"use server";

import { revalidatePath } from "next/cache";
import {
  createProject,
  setProjectStatus,
  toggleNeedsYou,
} from "@/lib/store";
import type { ProjectStatus } from "@/lib/types";

export async function addProjectAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const goal = String(formData.get("goal") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();

  if (!name) {
    return;
  }

  await createProject({ name, goal, source });
  revalidatePath("/");
}

export async function setStatusAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ProjectStatus;
  if (id && status) {
    await setProjectStatus(id, status);
    revalidatePath("/");
  }
}

export async function toggleNeedsYouAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) {
    await toggleNeedsYou(id);
    revalidatePath("/");
  }
}
