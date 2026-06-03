# Alignement undo / redo dans webdaw

## Cadrage

Ce document met les outils de webdaw en correspondance avec le modèle abstrait défini dans `UNDOREDOSPEC.md`, et identifie l'écart entre cette cible et l'implémentation actuelle. Il sert de référence pour les futures étapes d'implémentation du système d'undo / redo.

## Hiérarchie d'outils

| Niveau | Outil | Instance scopée par | Document propre |
|---|---|---|---|
| 0 | **webdaw** | session | Project document **hors contenu des chains** : tracks structure, clips, transport, timeline, marqueurs |
| 1 | **fx-chain / transform-chain** | par track + 1 transform global | Liste ordonnée d'effets + bypass + ordre |
| 2 | **faust-fx** | par effet | Code source + paramètres + métadonnées d'un effet |
| 2a | **faust-editor** | par effet (transient à l'ouverture) | Buffer texte du code |
| 2b | **faust-orbit-ui** | par effet | Viewport + sélection (les paramètres restent document de 2) |
| 3b | **calque-preset** | par uiHash (workspace, partagé entre orbit-ui exposant la même interface paramètres) | Bibliothèque IDB des presets |

Les niveaux 2a et 2b sont des sous-outils de 2 ; le niveau 3b est sous-outil de 2b.

## Frontières de commit (applications inter-niveau)

Conformément à la règle de la spec : *l'application d'un outil de niveau N+1 transmet au parent un snapshot par valeur*.

| Application | De | Vers | Forme |
|---|---|---|---|
| Save / compile du code | 2a | 2 | Buffer texte → `FxEffect.code` |
| Recall / drag / click sur disc | 3b | 2 (via 2b sans scope propre) | `preset.configuration` → params de l'effet |
| Commit de geste orbit-ui | 2b | 2 | Nouvelle config de params → `FxEffect.parameters` |
| Add / Remove / Reorder / Bypass effect | 2 | 1 | Mise à jour de la liste de la chain |
| Modification de la chain | 1 | 0 | Mise à jour du sous-arbre `track.effects` |

Pour les outils sans cycle distinct *édit / apply* (fx-chain, orbit-ui, et les ops bibliothèque du calque), l'action enregistre dans le scope local et l'effet est immédiatement visible au parent — le snapshot transmis est la nouvelle valeur du sous-document à ce point.

## Modèle d'implémentation cible — diff par scope

Le project document reste une structure mutable unique. Chaque scope enregistre des **diffs localisés** sur sa slice :

- **DAW scope** (0) — diffs sur tracks structure, transport, timeline, marqueurs (hors contenu des chains).
- **Chain scope** (1) — un par chain — diffs sur la liste d'effets et leur ordre / bypass.
- **Effect scope** (2) — un par effet — diffs sur le contenu d'un effet (code, params, métadonnées).
- **Editor scope** (2a) — un par session d'édition — buffer texte (déjà fourni par CodeMirror).
- **Orbit-ui scope** (2b) — un par effet — minimal ou vide suivant qu'on traite viewport / sélection comme état observable.
- **Library scope** (3b) — un par uiHash — Add / Rename / Delete / Trash batch sur la bibliothèque IDB.

L'indépendance des scopes (règle 1 de la spec) découle du fait que les diffs sont disjoints sur des slices disjointes du document.

## Identité par interface paramètres (`uiHash`) vs identité par source (`codeHash`)

Pour les scopes qui dépendent d'un effet Faust (2b orbit-ui, 3b calque-preset), la clef d'identification doit refléter l'**interface paramètres** du DSP — la liste de ses `vslider / hslider / nentry / ...` avec leurs adresses, plages, valeurs par défaut — et non la chaîne source complète.

La raison est concrète. L'utilisateur qui a investi du temps à fabriquer une bibliothèque de presets pour un effet, puis qui découvre une petite correction à apporter au code DSP (refactor interne, ajout d'un commentaire, fix d'un bug n'affectant pas l'UI), ne doit pas perdre l'accès à ses presets. Tant que la signature paramètres est inchangée, les presets restent applicables — leur `Record<address, value>` ne référence que les adresses, qui n'ont pas bougé.

D'où la distinction :

| Hash | Dérivé de | Stable face à |
|---|---|---|
| `codeHash` | la chaîne source complète | rien — change à chaque édit, même invisible côté UI |
| `uiHash` | la liste extraite `[{address, type, min, max, step, default}, ...]` après compilation | tout édit qui ne touche pas aux déclarations d'UI |

Dans cette spec on utilise `uiHash` partout où l'identité doit refléter « l'effet vu par l'utilisateur ». Un changement de code qui modifie l'UI (paramètre ajouté, retiré, plage changée) produit naturellement un nouveau `uiHash` et donc une bibliothèque / un scope orbit-ui frais — c'est le bon comportement.

L'audio peut sonner différent même si l'UI est identique (refactor du DSP préservant la signature mais changeant le rendu). Dans ce cas, les presets restent techniquement valides ; à l'utilisateur de juger s'ils gardent leur intention musicale et de les purger sinon. C'est le meilleur trade-off : ne **pas** détruire le travail par défaut, laisser la décision à l'utilisateur.

> **Note d'implémentation.** À ce jour, le code utilise `codeHash` (hash de la source) partout — `preset-storage.ts`, `preset-tracking.ts`, le calque, le menu de rappel. La bascule vers `uiHash` est un refactor indépendant de l'undo, qui touche le système de presets dans son ensemble (cf. PRESETSPEC.md). La présente spec d'undo emploie déjà la terminologie cible.

## Identification des scopes

Chaque scope est repéré par une **clef discriminée** dont la composition rend explicite l'instance concernée. Le système d'undo / redo maintient une table indexée par cette clef, qui retourne pour chaque scope son couple `(past, future)`. Le routage Cmd+Z par focus revient à choisir la clef du scope actif.

| Scope | Clef d'identification | Durée de vie |
|---|---|---|
| DAW | `{kind: "dawSession"}` (singleton) | toute la session |
| FX chain | `{kind: "fxChain", trackId}` | tant que la track existe |
| Transform chain | `{kind: "transformChain"}` (singleton) | toute la session |
| faust-fx | `{kind: "faustFx", effectId}` | tant que l'effet existe |
| faust-editor | `{kind: "faustEditor", effectId}` | transient — créé à l'ouverture, jeté à la fermeture (interne CodeMirror) |
| faust-orbit-ui | `{kind: "orbitUi", effectId, uiHash}` | tant que l'effet existe **et** que sa signature paramètres est inchangée |
| calque-preset | `{kind: "calquePreset", uiHash}` | toute la session ; **partagé** entre tous les calques actifs sur la même signature paramètres, indépendant de l'existence d'un effet |

Typage TypeScript correspondant :

```ts
type UndoScopeKey =
  | { kind: "dawSession" }
  | { kind: "fxChain"; trackId: TrackId }
  | { kind: "transformChain" }
  | { kind: "faustFx"; effectId: FxEffectId }
  | { kind: "faustEditor"; effectId: FxEffectId }
  | { kind: "orbitUi"; effectId: FxEffectId; uiHash: string }
  | { kind: "calquePreset"; uiHash: string };
```

**Cohabitation niveau 2 / 2b par effectId.** Les scopes `faustFx` et `orbitUi` partagent le même `effectId` mais restent distincts (`kind` différent, et 2b ajoute `uiHash`). Le `kind` désigne l'**outil**, les autres champs désignent l'**instance** — deux outils peuvent partager un identifiant sans confondre leurs scopes.

**Pourquoi le `uiHash` dans 2b mais pas dans 2.** Le document de 2 (faust-fx) **contient** le code — un édit de code est une entrée légitime dans ce scope. Le code reste donc dans le document, pas dans la clef. Le document de 2b (orbit-ui) est un layout dans l'espace des paramètres, qui n'a de sens que **relativement** à la signature paramètres courante ; un changement d'UI rend le layout précédent inutilisable. La signature est donc dans la clef de 2b, pas dans son document. Règle générale : *un outil dont l'état n'a de sens que dans un certain contexte doit porter ce contexte dans sa clef.*

**Particularité du scope library (3b).** Sa clef ne contient pas d'identifiant d'instance d'outil ; elle est dérivée de la **signature paramètres** (`uiHash`). Conséquence directe : plusieurs orbit-ui actifs sur la même signature partagent une seule pile d'undo bibliothèque. La suppression du dernier effet utilisant cette signature ne purge pas le scope — l'historique reste accessible si un autre effet de même signature est créé plus tard dans la session. C'est l'illustration concrète de la clause d'échappement de la règle 6 : *« sauf si le produit définit explicitement un outil global partagé »*.

**Garbage collection.** Pour tous les autres scopes, la disparition de l'entité-clef (track, effet) déclenche la collecte du scope correspondant. Pour le scope library, la collecte se fait à fin de session.

## Audit de l'implémentation actuelle

| Scope cible | État actuel | Conformité |
|---|---|---|
| DAW scope (0) | Confondu avec tous les sous-niveaux dans la pile session-document monolithique | ✗ |
| Chain scope (1) | Inexistant ; les ops sont dans la pile monolithique | ✗ |
| Effect scope (2) | Inexistant ; les ops vont dans la pile monolithique | ✗ |
| Editor scope (2a) | Fourni par CodeMirror, save = commit vers `FxEffect.code` | ✓ |
| Orbit-ui scope (2b) | Pas de viewport undo ; les commits de geste vont dans la pile monolithique | ✗ |
| Library scope (3b) | Inexistant ; les ops IDB sont irrévocables (confirmation pour les destructives) | ✗ |

**Synthèse** : un seul scope conforme à la cible (2a, hérité de CodeMirror), un scope monolithique unique qui aplatit les niveaux 0 à 2b, et un niveau (3b) sans scope du tout. L'écart est large.

## Écart à combler

1. **Refactor du monolithique en diff-par-scope** sur le project document : transformer `commitCurrentSessionDocumentChange` en plusieurs piles, chacune scopée à sa slice. Cela couvre les niveaux 0, 1, 2 et 2b en une fois.
2. **Création du Library scope (3b)** : pile dédiée Add / Rename / Delete / Trash batch sur la bibliothèque IDB. Indépendante du refactor 1 puisque la bibliothèque vit déjà dans un store distinct.
3. **Migration `codeHash` → `uiHash`** sur le système de presets (`preset-storage`, `preset-tracking`, panels, calque, menu de rappel) — préalable indispensable pour que les scopes 2b et 3b aient la stabilité voulue face aux édits de code n'affectant pas l'UI. Indépendant de la mécanique d'undo elle-même mais conditionne sa correction.
4. **Décision sur 2b orbit-ui** : si on undo le viewport / la sélection, créer un scope minimal ; sinon accepter que ce sont des transients hors-undo.
5. **Composition pour Cmd+Z** : routage par focus. Le scope focusé consomme le keystroke même s'il est vide — pas de fall-through vers le parent. Le contrat « ce que dit le footer = ce que Cmd+Z affecte » prime sur la commodité d'enchaîner des annulations à travers la hiérarchie. Applique les règles 1 (indépendance), 2 (persistance), 7 (bifurcation locale), 8 (politique de branches).

## Priorités recommandées

| Étape | Travail | Difficulté | Bénéfice utilisateur |
|---|---|---|---|
| **3b Library scope** | Pile dédiée + routing Cmd+Z dans le calque | Modéré — bibliothèque déjà séparée structurellement | Haut — comble la lacune visible (« j'ai supprimé un preset par erreur, irrécupérable ») |
| **1 + 2 Chain + Effect scopes** | Refactor du undo en multi-scope diff-based | Lourd — touche le cœur du système d'undo | Modéré — gain de modularité ; convention DAW favorise au contraire la pile unifiée, donc bénéfice perçu modeste |
| **2b Orbit-ui scope** | Viewport / sélection undo | Mineur (si vide) à modéré (si couvre viewport) | Faible — état transient, undo peu attendu par l'utilisateur |

L'étape 3b est isolable et autoporteuse — candidate naturelle pour une première étape concrète. Les étapes 1 + 2 demandent un refactor du système d'undo lui-même et un arbitrage UX (pile unifiée à la mode DAW vs scopes par niveau).

## Hors-scope

- Format concret des diffs (apply, invert, compose) — choix d'implémentation.
- Profondeur, éviction, persistance long terme entre sessions — paramètres de déploiement.
- Politique de branches (linéaire vs arborescente) par scope — choix d'implémentation, applicable indépendamment.
