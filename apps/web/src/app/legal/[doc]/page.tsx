import { notFound } from "next/navigation";
import { LEGAL_DOCS, isLegalDoc } from "@/lib/legal.ts";
import { readLegal } from "@/lib/legal-content.ts";
import { LegalView } from "@/components/legal.tsx";

export const dynamicParams = false;
export const generateStaticParams = () => LEGAL_DOCS.map((doc) => ({ doc }));

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  return <LegalView doc={doc} html={readLegal(doc)} />;
}
