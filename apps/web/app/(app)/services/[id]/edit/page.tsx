"use client";
import { useParams } from "next/navigation";
import { ProGate, useIsPro } from "@/components/pro-gate";
import { ServiceForm } from "@/components/service-form";

export default function EditService() {
  const { id } = useParams<{ id: string }>();
  const pro = useIsPro();
  if (!pro) return <ProGate back={`/services/${id}`} />;
  return <ServiceForm id={id} />;
}
