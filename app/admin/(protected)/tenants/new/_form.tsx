"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { INTERFACE_COMPLETA } from "@/lib/navigation/interface";
import { tenantCreationFields } from "@/lib/schemas/tenant-creation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CreateTenantResponse, useCreateTenant } from "@/hooks/useCreateTenant";
import { ApiError } from "@/lib/api/types";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { copyToClipboard } from "@/lib/clipboard";

// ---------------------------------------------------------------------------
// Schema (mirrors server Zod; client keeps it in sync)
// ---------------------------------------------------------------------------

const formSchema = z.object(tenantCreationFields);

type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Form component
// ---------------------------------------------------------------------------

/** Um plano ativo de `cobranca_planos`, como o formulário o oferece. */
export interface PlanoParaEscolher {
  id: string;
  nome: string;
  preco_cents: number;
  moeda: string;
  intervalo: string;
  trial_dias: number;
}

export function NewTenantForm({
  cobranca,
  moldeDeIa = null,
  agenciasLigado = false,
}: {
  /** Spec da cobrança §9: ligada, o plano de cobrança substitui o rótulo antigo (D-2). */
  cobranca: { ligada: boolean; planos: readonly PlanoParaEscolher[] };
  /**
   * O molde de IA da instalação (migration 9096), quando há um: a empresa que
   * nascer deste formulário recebe a IA dele. Dito AQUI, no momento de criar,
   * e não só em Recursos opcionais — é aqui que a pessoa decide criar.
   */
  moldeDeIa?: { nome: string } | null;
  /** Módulo `agencias` (doc 321). Desligado, o bloco some e o pedido não leva `agencia`. */
  agenciasLigado?: boolean;
}) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const createTenant = useCreateTenant();
  const [created, setCreated] = useState<CreateTenantResponse["data"] | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      display_name: "",
      slug: "",
      legal_name: "",
      cnpj: "",
      plan: "standard",
      plano_id: undefined,
      owner_email: "",
      agencia: { habilitada: false, limite_clientes: 0, clientes_inclusos: false },
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  // Auto-generate slug from display_name until user edits slug manually
  const handleDisplayNameChange = (value: string) => {
    setValue("display_name", value);
    // El identificador interno sale siempre del nombre: no se muestra ni se edita.
    setValue("slug", slugify(value), { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await createTenant.mutateAsync({
        display_name: values.display_name,
        slug: values.slug,
        // Ligada: o plano de cobrança (ausente = isenta) e nunca o rótulo antigo.
        ...(cobranca.ligada ? { plano_id: values.plano_id } : { plan: values.plan }),
        owner_email: values.owner_email,
        owner_interface_settings: INTERFACE_COMPLETA,
        ...(agenciasLigado ? { agencia: values.agencia } : {}),
      });

      toast.success(t("Tenant criado com sucesso!"));
      setCreated(result.data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "conflict") {
          form.setError("display_name", { message: t("Já existe uma organização com esse nome. Use outro.") });
          return;
        }
        toast.error(`${t("Erro ao criar tenant:")} ${err.message}`);
      } else {
        toast.error(t("Erro inesperado ao criar tenant"));
      }
    }
  });

  if (created)
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{t("Organização criada")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            {t("Você já é administrador de")} {created.display_name}.
          </p>
          {created.owner_invitation && (
            <div className="space-y-3">
              <p>
                {created.owner_invitation.email_dispatched
                  ? t("Convite enviado por e-mail.")
                  : t(
                      "O envio por e-mail não foi confirmado. Copie o link e compartilhe com o responsável.",
                    )}
              </p>
              <Label htmlFor="owner-invite">{t("Link do convite")}</Label>
              <Input id="owner-invite" readOnly value={created.owner_invitation.accept_url} />
              <p>
                {t("Válido até")}{" "}
                {new Date(created.owner_invitation.expires_at).toLocaleString(idioma)}.
              </p>
              <Button
                onClick={async () => {
                  if (await copyToClipboard(created.owner_invitation!.accept_url))
                    toast.success(t("Link copiado"));
                  else toast.error(t("Selecione e copie o link acima."));
                }}
              >
                {t("Copiar convite")}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t("Se o convite vencer, abra Equipe na organização para gerar outro.")}
              </p>
            </div>
          )}
          <Button asChild>
            <a href="/app">{t("Voltar ao aplicativo")}</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/admin/tenants/${created.id}`}>{t("Ver organização")}</a>
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Nova organização")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Você terá acesso como administrador e poderá concluir a configuração inicial.")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Dados da organização")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {/* display_name */}
            <div className="space-y-1.5">
              <Label htmlFor="display_name">
                {t("Nome da agência")} <span className="text-error-fg">*</span>
              </Label>
              <Input
                id="display_name"
                placeholder={t("Autos del Sur")}
                {...register("display_name")}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                aria-invalid={!!errors.display_name}
              />
              {errors.display_name && (
                <p className="text-xs text-error-fg">{t(errors.display_name.message ?? "")}</p>
              )}
              {!errors.display_name && errors.slug && (
                <p className="text-xs text-error-fg">
                  {t("Use um nome com pelo menos uma letra ou número.")}
                </p>
              )}
            </div>

            {agenciasLigado && (

            <div className="space-y-3 rounded-lg border p-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" {...register("agencia.habilitada")} />
                {t("Permitir que esta agência administre organizações clientes")}
              </label>
              <Label htmlFor="limite_clientes">{t("Limite de organizações clientes")}</Label>
              <Input
                id="limite_clientes"
                type="number"
                min={0}
                max={10000}
                step={1}
                {...register("agencia.limite_clientes", { valueAsNumber: true })}
              />
              <label className="flex items-center gap-2">
                <input type="checkbox" {...register("agencia.clientes_inclusos")} />
                {t("Incluir clientes no acordo comercial da agência")}
              </label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Autoriza criar clientes sem assinatura individual, mesmo com cobrança ativa. Valores e porcentagens são negociados separadamente; não há cobrança automática por cliente.",
                )}
              </p>
            </div>
            )}
            {/* owner_email */}
            <div className="space-y-1.5">
              <Label htmlFor="owner_email">
                {t("E-mail do responsável")} <span className="text-error-fg">*</span>
              </Label>
              <Input
                id="owner_email"
                type="email"
                placeholder="responsable@empresa.com"
                {...register("owner_email")}
                aria-invalid={!!errors.owner_email}
              />
              {errors.owner_email && (
                <p className="text-xs text-error-fg">{t(errors.owner_email.message ?? "")}</p>
              )}
            </div>

            {moldeDeIa && (
              <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="aviso-molde-de-ia">
                {t(
                  "A IA desta empresa vai nascer copiada de {empresa}, o molde escolhido em Recursos opcionais: o modelo de cada função e o modelo padrão, com a chave de IA desta instalação.",
                ).replace("{empresa}", moldeDeIa.nome)}
              </p>
            )}
            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("Criando...") : t("Criar organização")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                {t("Cancelar")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
