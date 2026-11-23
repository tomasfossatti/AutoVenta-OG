"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { acceptWelcome } from "@/app/actions/onboarding/acceptWelcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FUSO_DA_ARGENTINA,
  PROVINCIAS_ARGENTINAS,
  PROVINCIA_PADRAO,
  RUBROS_DE_CONCESIONARIA,
} from "@/lib/onboarding/datos-de-concesionaria";

export function WelcomeForm({ defaultOrgName, orgId }: { defaultOrgName: string; orgId: string }) {
  const t = useT();
  const [displayName, setDisplayName] = useState(defaultOrgName);
  const [oQueFaz, setOQueFaz] = useState("");
  // Fork AutoVenta: a província da agência, com Neuquén marcada. Ela não muda o
  // fuso — a Argentina inteira é UTC-3 — e entra no prompt do agente
  // (`lib/onboarding/datos-de-concesionaria.ts`).
  const [provincia, setProvincia] = useState<string>(PROVINCIA_PADRAO);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-5 rounded-lg border bg-background p-6"
      // `onSubmit` con `preventDefault`, y no `action`: React 19 reinicia el
      // formulario después de un `action`, y en un grupo de radios controlados
      // no vuelve a marcar el elegido. Con el error `organization_changed` la
      // persona perdía el rubro que había marcado (fork AutoVenta: el rubro es
      // un radio; en el upstream era un campo de texto, que sí se restaura).
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        if (!accepted) {
          toast.error(t("Aceite os termos para continuar."));
          return;
        }
        startTransition(async () => {
          const res = await acceptWelcome(formData);
          if (res && !res.ok) {
            toast.error(
              res.error === "organization_changed"
                ? t("A empresa ativa mudou. Recarregue a página antes de continuar.")
                : `${t("Falha:")} ${res.error}`,
            );
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="display_name">{t("Como se chama o seu negócio?")}</Label>
        <Input
          id="display_name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          minLength={2}
          maxLength={120}
          required
        />
        <p className="text-xs text-muted-foreground">
          {t(
            "É o nome que aparece para o seu time e nos relatórios. Pode ser clínica, loja, escritório — o que for seu.",
          )}
        </p>
      </div>

      {/*
        A pergunta que faltava no produto inteiro, fechada para o fork: uma
        concessionária vende 0km, usados ou os dois. Cada opção grava a frase que
        o prompt do agente usa ("La agencia se dedica a la venta de autos 0km").
      */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">{t("O que a agência vende?")}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
          {RUBROS_DE_CONCESIONARIA.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="o_que_faz"
                value={r.frase}
                checked={oQueFaz === r.frase}
                onChange={() => setOQueFaz(r.frase)}
                required
              />
              {t(r.rotulo)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Com isso seu funcionário sabe que carros a agência oferece.")}
        </p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="provincia">{t("Em que província fica a agência?")}</Label>
        <Select value={provincia} onValueChange={setProvincia}>
          <SelectTrigger id="provincia">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVINCIAS_ARGENTINAS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="provincia" value={provincia} />
        <input type="hidden" name="timezone" value={FUSO_DA_ARGENTINA} />
        {/* A org para a qual ESTA aba foi aberta. No submit, o server action
            resolve por ela (validada como membership), não pela org ativa do
            momento — que outra aba pode ter trocado. */}
        <input type="hidden" name="organization_id" value={orgId} />
        <p className="text-xs text-muted-foreground">
          {t("Seu funcionário a menciona ao se apresentar. O horário de atendimento é o da Argentina.")}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          {t("Li e aceito os")}{" "}
          <a className="underline" href="/legal/terms" target="_blank" rel="noreferrer">
            {t("Termos de Uso")}
          </a>{" "}
          {t("e a")}{" "}
          <a className="underline" href="/legal/privacy" target="_blank" rel="noreferrer">
            {t("Política de Privacidade")}
          </a>
          .
        </span>
      </label>

      <div className="flex sm:justify-end">
        <Button type="submit" disabled={pending || !accepted} className="w-full sm:w-auto">
          {pending ? t("Salvando...") : t("Continuar")}
        </Button>
      </div>
    </form>
  );
}
