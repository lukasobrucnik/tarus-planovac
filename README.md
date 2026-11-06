# TARUS Plánovač

Soukromý panel pro plánování příspěvků na sociálních sítích. Statická stránka (GitHub Pages) + přihlášení a databáze ve Firebase (zdarma, bez karty).

Bez nastavení Firebase běží v **lokálním režimu**: data jsou jen v prohlížeči, kde stránku otevřeš. Pro přístup z telefonu a přihlášení udělej kroky níže (cca 10 minut).

## 1. Firebase (jednorázově)

1. Na https://console.firebase.google.com vytvoř projekt (Analytics vypni).
2. **Build > Authentication > Get started > Email/Password** zapni.
   - **Settings > User actions**: odškrtni **Enable create (sign-up)**, ať se nikdo cizí nemůže zaregistrovat.
   - **Users > Add user**: přidej svůj e-mail a heslo.
3. **Build > Firestore Database > Create database** (production mode, region `eur3` nebo `europe-west`).
   - Záložka **Rules**: vlož obsah souboru `firestore.rules` a dej **Publish**.
4. Role: v Authentication > Users zkopíruj své **User UID**. Ve Firestore vytvoř kolekci `roles`, dokument s ID = tvoje UID a polem `role` (string) = `owner`.
5. **Project settings > Your apps > Web (`</>`)**: zaregistruj aplikaci a hodnoty `apiKey`, `authDomain`, `projectId`, `appId` vlož do `firebase-config.js`.
6. **Authentication > Settings > Authorized domains**: přidej `TVOJEJMENO.github.io`.

## 2. GitHub Pages

1. Vytvoř repozitář (např. `tarus-planovac`) a nahraj do něj obsah této složky.
2. **Settings > Pages > Deploy from a branch > main / (root)**.
3. Adresa: `https://TVOJEJMENO.github.io/tarus-planovac/`. Na telefonu ji dej "Přidat na plochu".

Repozitář může být veřejný. Konfigurace Firebase není tajná, data chrání přihlášení a pravidla v `firestore.rules`. Do repozitáře nikdy nedávej hesla ani zálohy s daty.

## 3. Robert (později)

1. Authentication > Users > Add user (jeho e-mail a heslo).
2. Firestore: `roles/{jeho UID}` s polem `role` = `editor`.

Editor vidí vše, může přidávat nové nápady (vždy ve stavu "Nápad") a dopisovat komentáře. Nemůže nic upravit ani mazat. Pravidla to vynucují na straně databáze.

## Zálohy

Menu **⋯ > Stáhnout zálohu** uloží všechno do JSON na tvůj počítač. Stejným menu lze zálohu obnovit.
