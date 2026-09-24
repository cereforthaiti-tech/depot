# Leads Business Platform

SaaS multi-tenant: yon sèl platfòm, plizyè biznis, done chak biznis izole.

```
LEADS BUSINESS PLATFORM
│
├── Platform Owner        (kontwòl total, 1 sèl pou tout platfòm nan)
├── Super Admin           (jere biznis, abònman, sekirite — kreye pa Platform Owner)
│
└── Businesses (tenants)
     ├── Business Admin   (kontwòl total sou pwòp biznis li)
     ├── Manager          (aksè operasyonèl — stock, vant, kès, elatriye)
     └── Business User    (aksè limite, selon pèmisyon)
```

## Poukisa zewo dependans

Tout bagay ekri ak Node.js pi (module `http`, `fs`, `crypto` — deja nan Node).
Pa gen `npm install` pou fè. Sa vle di li ka tounen menm jan sou:
- yon ti VPS/hosting ki gen Node,
- Termux sou Android (menm jan ak LeadStock ERP),
- machin lokal ou pou tès.

Done yo estoke nan fichye JSON anba `server/data/` — fasil pou enspekte, backup,
oswa migre pita nan yon vrè baz done (PostgreSQL, SQLite, elatriye) san chanje
lojik routes yo.

## Kòmanse

```bash
node server/index.js
# API a ap tounen sou http://localhost:4000
```

Louvri `public/index.html` nan yon navigatè (double-clic oswa `open public/index.html`).
Premye etap: kreye kont **Platform Owner** la (yon sèl fwa).

## Estrikti pwojè a

```
server/
  db.js       — kouch done JSON, zewo dependans (insert/update/remove/audit)
  auth.js     — token HMAC san eta (pa gen sesyon sèvè pou jere)
  roles.js    — yerachi wòl + katalòg pèmisyon pa modil (stock, sales, caisse...)
  index.js    — sèvè HTTP + tout routes API
  data/       — fichye JSON (kreye otomatikman, pa nan git)
public/
  index.html  — frontend vanilla JS (san build), platfòm + biznis nan menm paj
```

## Modèl done prensipal yo

| Koleksyon        | Sa li reprezante                                            |
|-------------------|---------------------------------------------------------------|
| `platformUsers`   | Platform Owner + Super Admin(s)                               |
| `businesses`      | Chak biznis (tenant), ak modil aktive li yo                   |
| `businessUsers`   | Business Admin / Manager / Business User, ratache a yon biznis|
| `plans`           | Katalòg plan abònman (defini pa Platform Owner)                |
| `subscriptions`   | Biznis ↔ plan ↔ estati (trialing / active / past_due / suspended) |
| `depots`          | Depo/branch pou chak biznis (yon biznis ka gen plizyè)         |
| `auditLog`        | Trace aksyon sansib (kreyasyon biznis, chanjman pèmisyon, elatriye) |

## Izolasyon done ant biznis

Chak route biznis verifye `businessId` nan token la kont `:id` nan URL la
(`requireBusinessAuth` + `actor.businessId !== params.id` → 403). Yon itilizatè
biznis A pa janm ka li oswa modifye done biznis B — te teste ak yon senaryo
kwaze pandan devlopman an.

## Pèmisyon (RBAC)

`roles.js` defini yon katalòg pèmisyon pa modil (`stock.*`, `sales.*`,
`caisse.*`, `users.*`, elatriye) ak yon set pèmisyon default pou chak wòl
(Business Admin, Manager, Business User). Business Admin ka bay yon itilizatè
espesifik yon lis pèmisyon pèsonalize (override) atravè
`PATCH /api/businesses/:id/users/:userId/permissions`.

## Kote pou kontinye

Sa a se **Fondasyon** — otantifikasyon, kreyasyon biznis, RBAC, wòl, depo,
plan/abònman, ak sispansyon biznis mache tèt ak zòrèy (teste otomatikman).
Modil biznis yo (stock, vant, kliyan, factire, caisse, depans, rapò) gen
kach permission ak "module gating" (`isSubscriptionActive`) deja an plas, men
kolèksyon done reyèl yo (pwodwi, tranzaksyon, elatriye) rete pou konstwi —
menm patwon ak `depots`/`businessUsers` la anwo a.

Pwochen etap natirèl yo:
1. Modil **Stock** konplè (pwodwi + mouvman, tankou LeadStock ERP)
2. Modil **Vant / Factire / Caisse**
3. Paj Super Admin pou aktive/chanje plan yon biznis dirèkteman nan UI la
4. (Opsyonèl, pita) migre `db.js` sou yon vrè baz done si volim done a grandi
