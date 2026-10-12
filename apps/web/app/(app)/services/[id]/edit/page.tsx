"use client";
import { useParams } from "next/navigation";
import { ServiceForm } from "@/components/service-form";

export default function EditService() {
  const { id } = useParams<{ id: string }>();
  return <ServiceForm id={id} />;
}
