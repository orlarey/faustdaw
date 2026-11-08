# Spécification : les matériaux des magasins, et le retour à la scène

## Scénario de référence

Dans faustmodular, un utilisateur a enregistré deux mesures d'une scène et les a publiées dans son magasin
(`orlarey/faust-store`) : un FLAC, sa fiche, et la scène telle qu'elle était au moment de l'enregistrement.

Il ouvre faustdaw. Le panneau *Magasins* montre le magasin qu'il suit déjà dans faustmodular ; il y trouve
l'enregistrement, avec son nom, sa durée, son tempo et la scène d'où il vient. Il le fait glisser sur la piste 2 :
le clip apparaît, sa forme d'onde se dessine pendant que le défilement reste fluide. Le clip porte une petite marque
de provenance.

Plus tard, il veut une variante. Un clic droit sur le clip, *Ouvrir la scène dans faustmodular* : faustmodular
s'ouvre sur la scène exacte de cet enregistrement. Il la modifie, l'enregistre et la publie ; de retour dans faustdaw,
il ajoute la nouvelle version à côté de l'ancienne.

## Portée de ce raffinement

- Lire les magasins suivis, et leurs **matériaux** (les enregistrements, `fauststore-material`, `STORE-SPEC.md` et
  `MATERIALS-SPEC.md` du dépôt faustmodular).
- Monter un matériau sur une piste : une ressource audio **avec sa provenance**, puis un clip.
- Revenir à la recette : *Ouvrir la scène dans faustmodular*.
- Placer un matériau à sa mesure, quand la session a un temps musical (`MUSICALTIMESPEC.md`).

Hors portée : publier depuis faustdaw (un projet faustdaw comme matériau, la relation `usedIn`), enregistrer dans
faustdaw, mettre à jour un clip depuis une nouvelle version du matériau (plus tard, sur le modèle de *Update From
Source Session*).

## Ce qui existe

- **Une provenance, déjà, pour une sorte de ressource.** Une ressource peut porter un `SessionRenderResourceLink`
  (rendu d'une autre session de faustdaw). Ce lien est attaché à la ressource et non au clip, persisté dans l'archive
  (`resources.json`) et dans l'espace de travail, et ses états dérivés (lié, périmé) ne sont jamais stockés. Le lien
  vers un matériau suit ce modèle.
- **Un import de fichier** (`importAudioFile`, `decodeImportedAudioFile` dans `demo/interactions.ts`) : décodage par
  l'`AudioContext` du projet (48 kHz, le FLAC compris), repli sur FFmpeg WASM, puis `placeClip` et un pas d'annulation.
  Les octets d'origine sont gardés (`ResourceStorage.sourceFiles`). Rien n'est lu sur le réseau aujourd'hui.
- **Les magasins sont partagés** par l'origine `orlarey.github.io`, que faustdaw partage avec faustmodular et
  faustcode : les clés `faustmodular:stores` (les magasins suivis) et `faustmodular:store-tokens` (les jetons) sont
  lisibles telles quelles.

## Vocabulaire du domaine

- **Magasin** : un dépôt GitHub de modules, de scènes et de matériaux, avec un index (`STORE-SPEC.md`).
- **Matériau** : un enregistrement d'un magasin. Il a une fiche (`materials/<Nom>/<Nom>.json`) et un média (FLAC),
  et il est lié à la scène qui l'a produit (`recordingOf`, avec l'empreinte de son contenu).
- **Lien de matériau** : la provenance d'une ressource de faustdaw issue d'un matériau.
- **Recette** : la scène de faustmodular qui a produit un matériau.

## Types

```math
StoreKey ::= chaîne "propriétaire/dépôt"
Path ::= chemin dans un dépôt
CommitSha ::= 40 chiffres hexadécimaux
Sha1 ::= 40 chiffres hexadécimaux

MaterialTimeline ::= MaterialTimeline(tempo: réel, meter: entier, startTick: Tick, lengthTicks: Tick)

MaterialLink ::= MaterialLink(
  store: StoreKey,
  description: Path,             — la fiche
  commit: CommitSha,             — le commit lu : le même fichier, toujours
  media: Path,
  mediaSha1: Sha1,               — l'empreinte des octets du média
  name: chaîne,
  scene: Path | ⊥,               — recordingOf
  sceneSha1: Sha1 | ⊥,           — from.sha1 : la version exacte de la scène
  timeline: MaterialTimeline | ⊥,
  libfaust: chaîne | ⊥
)

ResourceOrigin ::= AudioFile | SessionRender(SessionRenderResourceLink) | Material(MaterialLink)
```

Comme pour le rendu de session, le lien est porté par la **ressource** : un même matériau, monté plusieurs fois, est
une seule ressource et plusieurs clips. `ResourceOrigin` est dérivé de la présence d'un lien ; il n'est pas stocké.

## Invariants

```math
I-S1 :  ∀ r :  Material(l) = origine(r)  ⇒  sha1(octets(r)) = l.mediaSha1        — vérifié à l'import
I-S2 :  ∀ r :  au plus un lien (session ou matériau)
I-S3 :  ∀ r₁ r₂ :  origine(r₁) = Material(l₁) ∧ origine(r₂) = Material(l₂) ∧ l₁.mediaSha1 = l₂.mediaSha1  ⇒  r₁ = r₂
I-S4 :  une ressource dérivée (fusion, fondu enchaîné, inversion, éclatement) n'a pas de lien de matériau
```

I-S4 est la règle actuelle pour les rendus de session (`resourceSink.create` efface le lien). La découpe garde la
ressource, et donc son lien. Une relation `derivedFrom` est un point ouvert.

## Opérations

### Lire les magasins

```math
Stores⟦⟧ = les magasins de `faustmodular:stores`, lus avec la bibliothèque `fauststore`
```

- **Le code.** faustdaw garde une copie de la bibliothèque des magasins de faustmodular (`fauststore`, un module ES
  sans dépendance), avec une déclaration de types minimale. Il ne la réécrit pas : même index, mêmes empreintes,
  mêmes jetons.
- **Le panneau *Magasins*** liste les magasins suivis et, pour chacun, ses matériaux : nom, durée, tempo et mesure,
  date, scène d'origine. Il propose une recherche, *Suivre un magasin…* et *Relire*. Les modules et les scènes n'y
  figurent pas en version 1.
- **Les autres onglets.** Un magasin suivi dans faustmodular ou faustcode apparaît ici, et réciproquement (l'événement
  `storage`).

### Monter un matériau

```math
                pré  l.media lu au commit l.commit ;  sha1(octets) = l.mediaSha1  ;  r décodé à project.timebase.sampleRate
                ─────────────────────────────────────────────────────────────────────────────────────── [ImportMaterial]
                ImportMaterial⟦p, l, piste, c⟧ = placeClip(p ⊕ r, clip(r), c, piste)  avec  origine(r) = Material(l)
```

- **Le geste.** On glisse un matériau du panneau sur une piste, avec le type MIME `application/x-faustdaw-material`.
  Le dépôt prend une nouvelle branche du gestionnaire de dépôt de `timelineGrid`, avant les autres. *Ajouter à la
  piste sélectionnée* fait la même chose au curseur.
- **Le téléchargement.** Le média est lu au commit du lien (adresse brute de GitHub, ou API avec le jeton du magasin
  s'il est privé). Les octets passent par le chemin d'import existant (`decodeImportedAudioFile`, FLAC natif, repli
  FFmpeg).
- **Le dédoublonnage.** Si une ressource a déjà ce `mediaSha1` (I-S3), on la réutilise : rien n'est téléchargé.
- **La position.**
  - Par défaut, la position de dépôt, aimantée.
  - Avec un temps musical, le menu propose *Placer à sa mesure* : `C⟦m, l.timeline.startTick⟧`.
- **Le tempo.** Si le tempo du matériau diffère de celui de la session, une note le dit (pas d'étirement).
- **L'annulation.** La création du clip est un pas d'annulation (« Ajouter le matériau X »). L'import de la ressource,
  comme tout import, ne s'annule pas (`SESSIONSPEC.md`).
- **L'attente.** Le clip n'est créé qu'une fois le média décodé : sa longueur en échantillons du projet n'est connue
  qu'alors. Pendant le téléchargement, le matériau porte un indicateur dans le panneau, et la position de dépôt est
  retenue.

### Revenir à la recette

```math
                pré  origine(clip.resource) = Material(l)  ∧  l.scene ≠ ⊥
                ──────────────────────────────────────────────────────────────── [OpenScene]
                OpenScene⟦clip⟧ = ouvrir  faustmodular ?recording=https://github.com/⟨l.store⟩/blob/⟨l.commit⟩/⟨l.description⟩
```

- **Le menu.** Une `MenuOperation` *Ouvrir la scène dans faustmodular*, sur le modèle d'*Open Source Session*
  (`demo/menu-operations/open-source.ts`). Elle est inscrite au menu du clip, avec `applies()` vrai pour un clip dont
  la ressource a un lien de matériau avec une scène.
- **Le rappel.** faustmodular retrouve la version exacte de la scène par `l.sceneSha1`, même si elle a été republiée
  (`MATERIALS-SPEC.md`, « Rappeler la scène d'un enregistrement »).
- **L'adresse de faustmodular** est `https://orlarey.github.io/faustmodular/`, ou `?faustmodular=<adresse>` de la page
  en développement local.
- **Le même menu** propose aussi *Voir le matériau sur GitHub*.

### Persistance

Le lien est persisté partout où le lien de rendu de session l'est déjà :

- `resources.json` de l'archive (`SessionArchiveResourceMetadata`, `decodeResourceMetadata` : un champ `material`
  optionnel, validé) ;
- les références de ressources de l'espace de travail (`WorkingSessionResourceRef`) ;
- la reconstruction des tables à l'ouverture d'une session (`applyLoadedSessionArchive`).

Le format reste en version 1. Une version plus ancienne de faustdaw ignore le champ : la ressource redevient un simple
fichier.

## Rendu : l'arrivée d'un matériau

L'arrivée asynchrone d'un média est le seul point de ce raffinement qui touche au rendu. Les règles de
`MUSICALTIMESPEC.md` (R0 à R3) s'appliquent. S'y ajoutent les règles suivantes, normatives.

- **R-S1.** Le décodage et le calcul des niveaux de forme d'onde se font hors du chemin critique : le décodage dans
  `decodeAudioData` (asynchrone), la pyramide dans le travailleur existant (`buildWaveformPyramidInBackground`), sans
  copie des canaux sur le fil principal quand c'est évitable.
- **R-S2.** Au plus une invalidation des tampons par frame, quel que soit le nombre de niveaux ou de matériaux
  arrivés : `cacheWaveformPyramid` n'invalide plus de lui-même. Les arrivées sont regroupées et l'invalidation est
  posée pour la frame suivante.
- **R-S3.** Pendant un geste (pan de règle, glisser de clip, zoom) ou pendant la lecture, l'invalidation est
  **différée** à la fin du geste, ou à la prochaine reconstruction de géométrie qui aurait eu lieu de toute façon.
  Une arrivée ne déclenche jamais `render()` pendant un geste ; le rendu de session actuel
  (`materializeSessionRenderResource`) passe par le même chemin gardé.
- **R-S4.** Une pyramide n'est publiée pour le dessin qu'avec le niveau du zoom courant. Sans lui, le clip est dessiné
  sans forme d'onde, plutôt que par le repli détaillé, qui parcourt les échantillons bruts.
- **R-S5.** Une ressource en attente n'est jamais synthétisée par `getOrCreateAudioBuffer` au moment de la lecture :
  elle est exclue du plan tant qu'elle n'est pas décodée.
- **R-S6.** Les textures GPU d'un matériau sont envoyées en temps libre (`requestIdleCallback`), pas pendant le
  remplissage d'une division au cours d'un pan.
- **R-S7 (plus tard).** Une invalidation limitée aux divisions qui touchent la ressource arrivée, au lieu de la
  version globale.

## Propriétés

```math
P-S1 :  ImportMaterial ne modifie aucun clip existant (hors poussée de placement, CLIPPLACEMENTSPEC.md)
P-S2 :  OpenScene ne modifie pas la session
P-S3 :  monter deux fois le même matériau ne télécharge qu'une fois (I-S3)
P-S4 :  une session sauvée puis rouverte garde, pour chaque ressource, son lien de matériau
```

## Phases

1. **Lire et monter** : la copie de `fauststore`, le panneau, le glisser-déposer, le lien et sa persistance, les règles
   R-S1 à R-S6.
2. **Revenir à la recette** : *Ouvrir la scène dans faustmodular*, *Voir le matériau sur GitHub*.
3. **À sa mesure** : *Placer à sa mesure* (préalable : la phase 1 de `MUSICALTIMESPEC.md`).
4. **Plus tard** :
   - mettre à jour un clip depuis une nouvelle version du matériau ;
   - publier un projet faustdaw (`usedIn`) ;
   - enregistrer dans faustdaw.

## Critères d'acceptation

- **C-S1.** Le magasin `orlarey/faust-store`, suivi dans faustmodular, apparaît dans le panneau ; ses enregistrements
  sont listés avec leur tempo et leur scène.
- **C-S2.** Un enregistrement glissé sur une piste donne un clip dont les échantillons sont ceux du FLAC
  (rééchantillonné à 48 kHz s'il le fallait) ; sa ressource a le lien, et `sha1(octets) = mediaSha1`.
- **C-S3.** Le même enregistrement monté deux fois : une seule ressource, deux clips, un seul téléchargement.
- **C-S4.** *Ouvrir la scène dans faustmodular* ouvre la scène de l'enregistrement. Si la scène a été republiée
  depuis, c'est la version de l'enregistrement qui s'ouvre (vérifié par son empreinte).
- **C-S5.** Pan continu sur 2000 clips pendant l'arrivée de 5 matériaux : `pan.frameGap.ms` à ±5 % du pan sans arrivée,
  aucune reconstruction complète des tampons pendant le geste (R-S3).
- **C-S6.** Une session avec des matériaux, sauvée en ZIP puis rouverte, garde les liens (P-S4).
