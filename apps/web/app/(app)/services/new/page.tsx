"use client";
import { ProGate, useIsPro } from "@/components/pro-gate";
import { ServiceForm } from "@/components/service-form";

export default function NewService() {
  const pro = useIsPro();
  if (!pro) return <ProGate />;
  return <ServiceForm />;
}
