import { ContractDetail } from "@/components/contract-detail";

export default function ContractDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6">
      <ContractDetail contractId={params.id} />
    </div>
  );
}
