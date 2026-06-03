# Spécification Multi-Sessions

## Objet du document

Ce document décrit une extension de l'architecture de session du DAW pour
permettre :

- plusieurs **sessions nommées ouvertes dans un workspace** ;
- l'ouverture de **sessions différentes dans plusieurs fenêtres ou onglets** ;
- le **drag&drop entre deux sessions** ouvertes dans le navigateur.

Il complète [SESSIONSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/SESSIONSPEC.md).

Il ne remplace pas la définition du document de session lui-même.

Il formalise la couche supérieure :

- gestion d'un ensemble de sessions ouvertes ;
- persistance locale du workspace ;
- circulation de fragments entre sessions.

## Problème

Une seule "session courante" autosauvée ne suffit pas à long terme.

Nous voulons pouvoir :

- garder plusieurs documents de travail distincts dans un même workspace ;
- leur donner des noms lisibles ;
- ouvrir des sessions différentes en parallèle ;
- déplacer ou copier rapidement des clips d'une session à une autre.

Autrement dit, nous ne voulons plus seulement :

- "retrouver la dernière session au rechargement"

mais aussi :

- "retrouver un ensemble de sessions ouvertes"
- "ouvrir la bonne session dans la bonne fenêtre"
- "faire circuler des éléments entre sessions"

## But

Nous voulons introduire un **workspace local multi-sessions**.

Ce workspace doit fournir :

- un registre des sessions ouvertes ;
- une copie de travail persistée pour chacune ;
- un moyen d'ouvrir explicitement une session donnée ;
- un protocole de transfert temporaire pour le drag&drop inter-sessions.

## Principes généraux

La structure conceptuelle est désormais la suivante :

1. le **document de session**
2. les **ressources audio**
3. la **copie de travail locale** d'une session
4. le **registre local des sessions**
5. les **fragments temporaires de drag inter-sessions**

Le document de session reste :

- l'unité éditoriale ;
- la frontière de l'undo/redo ;
- le contenu logique de la timeline.

La nouveauté est que plusieurs documents de session distincts peuvent
désormais coexister dans le navigateur.

## Workspace

Le workspace doit être compris comme :

- l'ensemble des sessions actuellement ouvertes
- et persistées de façon à pouvoir être retrouvées si la page est fermée puis
  rouverte

Autrement dit :

- changer de session = **switcher** entre documents du workspace
- fermer une session = la retirer du workspace

Le workspace n'est donc pas un catalogue historique infini de toutes les
sessions ayant existé.

Il représente les documents actuellement ouverts.

## Identité d'une session

Une session locale doit avoir au minimum :

- un `sessionId` stable et opaque ;
- un `sessionName` éditable par l'utilisateur ;
- un `sessionRevision` dérivé de son contenu éditorial courant ;
- un `createdAt` ;
- un `updatedAt`.

Le `sessionId` n'est pas un label utilisateur.

Le `sessionName` n'est pas une clé technique.

Le `sessionRevision` n'est pas un compteur arbitraire.

Première règle :

- `sessionRevision` doit être une **révision de contenu**
- elle est dérivée du `SessionDocument`
- deux états éditoriaux strictement identiques doivent produire la même
  révision

Conséquence :

- un `undo` ramenant exactement au même contenu doit retrouver la même
  `sessionRevision`
- cette propriété est préférable à un simple compteur monotone pour les
  comparaisons de synchronisation

Première décision :

- l'identité logique de la session repose sur `sessionId`
- le nom n'est qu'une propriété éditable

Règle supplémentaire :

- les `sessionName` doivent être uniques dans le workspace local
- en cas de collision, le système ajoute automatiquement un suffixe `-n`
- `n` est le plus petit entier qui rend le nom unique
- la comparaison se fait sur un nom normalisé (trim + casse insensible)

## Registre local des sessions ouvertes

Le navigateur maintient un **registre local** des sessions ouvertes dans le
workspace.

Ce registre contient uniquement les métadonnées nécessaires à la navigation :

- `sessionId`
- `sessionName`
- `createdAt`
- `updatedAt`
- éventuellement quelques indicateurs simples comme `lastOpenedAt`

Le registre ne contient pas directement :

- les waveforms
- les buffers décodés
- les caches runtime

Il référence seulement les copies de travail persistées des sessions ouvertes.

## Copie de travail locale d'une session ouverte

Chaque session ouverte possède une **copie de travail persistée**.

Cette copie de travail contient :

- le `session.json`
- les ressources audio originales utilisées par la session
- les métadonnées minimales associées à ces ressources

Autrement dit :

- le registre liste les sessions ouvertes
- la copie de travail stocke le contenu de chacune

## Backend local

Le backend exact peut être choisi plus tard.

Les candidats naturels sont :

- `IndexedDB`
- `OPFS`
- ou une combinaison des deux

Première décision de conception :

- l'API logique du workspace multi-sessions ne doit pas dépendre d'un backend
  précis
- le backend concret est interchangeable

## Sessions nommées

Le système doit permettre au minimum :

- créer une session
- renommer une session
- ouvrir une session
- switcher vers une autre session ouverte
- dupliquer une session
- fermer une session

Règle supplémentaire pour le chargement d'une archive :

- charger une session depuis un `.zip` ne doit pas écraser la session
  actuellement ouverte
- le chargement doit créer ou ouvrir une **autre session dans le workspace**
- cette nouvelle session prend comme nom initial un label dérivé du **nom du
  fichier** chargé

L'export `.zip` reste un mécanisme séparé.

## Fermeture d'une session

Fermer une session signifie :

- retirer cette session du workspace
- supprimer sa copie de travail locale
- supprimer son historique undo/redo persistant éventuel
- libérer potentiellement ses ressources retenues si aucune autre session
  ouverte ne les référence encore

Donc `Close` ne signifie pas :

- exporter une archive
- archiver la session hors du workspace
- garder une entrée fantôme de session fermée dans le workspace

Le comportement attendu est celui d'un éditeur multi-documents :

- un document fermé disparaît de l'ensemble des documents ouverts

## Vues ouvertes sur une même session

Quand une même session est ouverte dans plusieurs vues, il faut distinguer :

- la **session** comme document du workspace
- les **vues** ou onglets qui affichent cette session

Première règle :

- le workspace ne doit pas reposer sur un simple compteur stocké manuellement
- il doit plutôt raisonner sur un ensemble de **vues ouvertes vivantes**
  identifiées par `tabId`
- le nombre de vues ouvertes pour une session est alors dérivé du nombre de
  leases de présence encore valides

Conséquence :

- fermer une vue n'implique pas forcément fermer la session du workspace
- seule la fermeture de la **dernière vue** ferme réellement la session

Autrement dit :

- `Close` dans une vue retire seulement cette vue de l'ensemble des vues
  ouvertes
- si d'autres vues affichent encore la même session, la session reste ouverte
  dans le workspace
- seul le dernier `Close` retire effectivement la session du workspace,
  supprime sa copie locale de travail, son undo/redo persistant éventuel et
  libère potentiellement ses ressources retenues

Première modélisation recommandée :

- un **view lease** pour représenter le fait qu'un onglet a la session ouverte
- un **writer lease** séparé pour représenter le fait qu'un onglet est
  l'éditeur actif

On obtient ainsi :

- plusieurs `view leases`
- un seul `writer lease`

Cas limite :

- si la session fermée était la dernière session ouverte du workspace, le DAW
  peut retomber sur un **brouillon local vide** qui n'appartient pas encore au
  workspace
- ce brouillon ne réapparaît pas dans la liste des sessions ouvertes tant qu'il
  n'a pas été explicitement ouvert ou persisté localement

Règle UX supplémentaire :

- si une session ouverte contient des modifications non encore persistées dans
  sa copie locale de travail, `Close` doit demander confirmation à
  l'utilisateur
- si la session n'est pas dirty, `Close` peut être immédiat

Précision importante en cas de vues multiples :

- ce prompt ne doit apparaître qu'au moment du **dernier close effectif**
- fermer une vue intermédiaire ne doit pas demander de sauver la session
  globale, puisque celle-ci reste encore ouverte ailleurs dans le workspace

Le critère pertinent n'est pas :

- "la session a-t-elle été exportée en `.zip` ?"

Le critère pertinent est :

- "l'état courant est-il bien reflété dans la copie locale persistée du
  workspace ?"

## Fenêtres et onglets

Une fenêtre ou un onglet du DAW doit pouvoir être associé explicitement à une
session donnée.

Le modèle cible est :

- une fenêtre = une session ouverte

Donc deux fenêtres peuvent afficher simultanément :

- deux `sessionId` différents

Exemple :

- fenêtre A : session `vocals-arrangement`
- fenêtre B : session `sound-design-bank`

## Ouverture explicite d'une session

Une session doit pouvoir être ouverte explicitement par son identifiant.

La forme exacte pourra être choisie plus tard, par exemple :

- un paramètre d'URL
- un hash
- un sélecteur de session initial
- ou une combinaison de ces mécanismes

Le point important est :

- il doit être possible de lancer deux fenêtres sur deux sessions différentes
  sans ambiguïté

## Ouverture simultanée de la même session

Le cas où deux fenêtres ouvrent **la même session** est plus délicat.

Il introduit :

- des conflits d'écriture ;
- des problèmes de fraîcheur de la copie locale ;
- la question de la fusion éventuelle.

Première décision :

- ce cas n'est plus hors scope ;
- il est traité par un modèle **1 writer / N followers**

Règle de base :

- à un instant donné, une seule vue peut être **writer** pour une session
  donnée ;
- les autres vues ouvertes sur cette même session sont des **followers**
  read-only.

Conséquence :

- une session ouverte plusieurs fois n'entre pas dans un mode d'édition
  concurrente libre ;
- il n'y a pas de fusion automatique entre plusieurs branches locales
  divergentes d'une même session.

## Writer, followers et lease

Le droit d'écriture sur une session ouverte simultanément dans plusieurs vues
doit reposer sur un **lease explicite**.

Ce lease doit contenir au minimum :

- `writerTabId`
- `writerLeaseExpiresAt`

Le focus navigateur peut servir de signal UX pour **tenter** de prendre le
lease, mais il ne suffit pas à lui seul comme source de vérité.

Règle retenue :

- une vue visible et focalisée tente de prendre le lease writer pour sa
  session ;
- une vue qui perd le focus ou devient cachée relâche ce lease après avoir
  flushé sa copie locale de travail si nécessaire ;
- si aucun writer valide n'existe plus, une autre vue focalisée peut prendre
  la main.

## Synchronisation entre vues ouvertes sur la même session

Les vues ouvertes sur une même session doivent se synchroniser explicitement.

Première décision :

- la synchronisation inter-onglets repose sur un canal léger de type
  `BroadcastChannel`
- le message minimal transporté est :
  - `type = "session-updated"`
  - `sessionId`
  - `sessionRevision`
  - `fromTabId`

Comportement :

- le writer publie un message à chaque persistance locale significative ;
- un follower recevant un message pour la session qu'il affiche recharge sa
  copie locale de travail ;
- les autres vues mettent au moins à jour leurs métadonnées de workspace pour
  pouvoir recalculer les états `linked / stale` des `session-render`.

Conséquence UX :

- deux vues ouvertes sur la même session doivent converger vers le même état ;
- une vue follower n'édite pas localement la session, elle la **suit**.

## Undo / Redo pour une session ouverte plusieurs fois

L'undo/redo reste attaché à la session ouverte, pas seulement à la vue active.

Conséquence :

- le writer persiste l'état courant ainsi que l'historique undo/redo associé ;
- lorsqu'un follower recharge la session depuis la copie locale du workspace,
  il recharge aussi cet historique ;
- un switch entre vues ou un rechargement léger ne doit pas effacer cet
  historique tant que la session reste ouverte dans le workspace.

Règle supplémentaire :

- une vue follower est read-only ;
- elle ne peut donc pas consommer cet undo/redo pour produire de nouvelles
  mutations locales tant qu'elle n'a pas repris le lease writer.

## Autosave multi-sessions

L'autosave continue d'exister, mais il devient **par session**.

Autrement dit :

- chaque vue writer autosauve la copie de travail de la session qu'elle édite ;
- l'autosave n'écrase jamais une autre session ;
- le registre met à jour `updatedAt` en conséquence.

Conséquence UX importante :

- quitter puis rouvrir la page doit restaurer le workspace de sessions ouvertes
- pas seulement la dernière session active

## Ressources audio

Les ressources persistées localement doivent rester les **ressources originales
importées**.

Le workspace multi-sessions ne doit pas dépendre de buffers décodés pour sa
persistance.

Les buffers décodés, pyramides et caches restent des dérivés runtime.

Règle supplémentaire :

- les bytes des ressources audio doivent être **dédupliqués** à l'échelle du
  workspace local
- si plusieurs sessions utilisent le même fichier source, le workspace ne doit
  le stocker qu'une seule fois
- les sessions ne doivent conserver que des références vers ce stock global de
  ressources

Mécanisme recommandé :

- clé par **SHA-256 du contenu binaire**
- déduplication par contenu, pas par nom de fichier

## Rétention des ressources par session ouverte

Le workspace ne doit pas dépendre uniquement des ressources présentes dans le
document courant d'une session.

En effet, dans ce modèle, changer de session est un **switch** entre sessions
ouvertes du workspace.

De plus, l'undo/redo d'une session doit pouvoir survivre à ce switch.

Première règle de conception :

- chaque session ouverte peut conserver un **ensemble de ressources retenues**
- cet ensemble est distinct du simple sous-ensemble de ressources visibles dans
  le document courant

Cet ensemble de rétention représente les ressources qui doivent rester
disponibles pour cette session, notamment parce qu'elles peuvent redevenir
nécessaires après undo/redo ou après certaines transitions internes du
workspace.

Conséquence :

- le GC global des ressources ne doit pas se baser uniquement sur l'état
  courant des documents
- il doit aussi considérer l'ensemble des ressources retenues par chaque
  session ouverte

Avantage de ce modèle :

- il évite de coupler directement le GC à la structure interne exacte des piles
  undo/redo
- il donne une sémantique plus robuste et plus simple pour le workspace

Il sera toujours possible plus tard d'ajouter :

- une commande explicite de nettoyage
- ou une compaction des ressources retenues

Mais la règle initiale doit être conservatrice :

- ne jamais supprimer une ressource qui peut encore être utile à une session
  du workspace

Quand une session est fermée :

- son ensemble de ressources retenues cesse d'exister
- les ressources qui n'étaient retenues que par elle peuvent alors être
  libérées si aucune autre session ouverte ne les retient

## Portée du drag&drop inter-sessions

Le drag&drop visé ici concerne :

- une fenêtre source du DAW ;
- une fenêtre cible du DAW ;
- dans le même navigateur ;
- sous la même origine ;
- dans le même profil utilisateur.

Ce n'est pas un drag&drop universel vers :

- une autre application ;
- un autre site ;
- un autre navigateur.

## Première version retenue

La première version du drag&drop inter-sessions ne porte **pas** sur des clips
simples transférés directement entre deux timelines.

La première version retenue est :

- une **icône de session dédiée** dans la fenêtre source ;
- cette icône représente la session elle-même comme **ressource audio
  virtuelle** ;
- le drop dans une autre session importe le **rendu audio** de cette session ;
- ce rendu est ensuite manipulé comme une ressource audio spéciale dans la
  session cible.

Autrement dit :

- on fait l'impasse, dans un premier temps, sur le drag&drop inter-fenêtres de
  clips simples ;
- on implémente d'abord le mécanisme hiérarchique de type **subproject /
  session-render resource**.

Le drag&drop de fragments de clips entre sessions reste une extension
envisageable plus tard.

## Principe du drag&drop inter-sessions

Le transfert ne doit pas reposer sur le passage direct d'objets runtime dans
`DataTransfer`.

Le modèle retenu est :

1. la source expose une **affordance dédiée** représentant la session
2. cette affordance démarre un **drag natif HTML**
3. la source sérialise un **payload temporaire de session-render**
4. ce payload est stocké localement
5. `DataTransfer` ne transporte qu'un **token opaque**
6. la cible résout ce token et importe la ressource rendue

Autrement dit :

- le drag transporte une référence temporaire ;
- pas les bytes complets ni les objets JS.

## Geste source et conflit avec l'autopan

Le drag&drop inter-sessions ne peut pas être pensé comme une simple extension
du drag intra-timeline existant.

En effet :

- le déplacement de clips dans la timeline repose aujourd'hui sur un geste
  pointer custom avec autopan horizontal ;
- le drag&drop entre fenêtres repose au contraire sur un **drag natif HTML**
  utilisant `DataTransfer`.

Première contrainte de conception :

- la première version ne doit pas essayer de transformer un drag pointer
  intra-timeline en drag natif au milieu du geste ;
- le geste source inter-sessions doit partir d'une **affordance dédiée**.

Conséquence UX :

- la source du drag inter-sessions doit se trouver **hors de la zone de
  timeline active**, de préférence dans une bande haute ou basse de la fenêtre,
  ou dans une poignée dédiée équivalente ;
- on évite ainsi tout conflit avec l'autopan latéral utilisé pour le
  déplacement intra-session.

Autrement dit :

- drag d'un clip dans la timeline = édition locale avec autopan ;
- drag inter-sessions = drag natif depuis une zone dédiée.

## Affordance source dédiée

La fenêtre source doit exposer une **icône de session** dédiée.

Première hypothèse UX :

- cette icône se place à gauche du combo de session ;
- elle représente la session elle-même ;
- elle peut être dragguée vers une autre fenêtre du DAW.

Cette icône ne représente pas :

- un clip particulier ;
- une sélection de clips ;
- ni la timeline source comme éditeur réinsérable.

Elle représente :

- le **rendu audio exportable** de la session.

## Payload temporaire de session-render

Le payload temporaire de drag inter-sessions contient :

- les informations nécessaires pour retrouver ou reconstruire le rendu audio de
  la session source ;
- les métadonnées minimales décrivant l'origine de cette ressource ;
- éventuellement les bytes rendus eux-mêmes ou une référence vers eux.

Ce payload n'est pas une session éditable complète dans la cible.

Il représente une **ressource audio dérivée de session**.

## Deux types de ressources audio

Le système doit distinguer au minimum :

- `audio-file`
- `session-render`

`audio-file` désigne :

- une ressource issue d'un fichier audio importé.

`session-render` désigne :

- une ressource issue du rendu audio d'une autre session.

Ces deux types de ressources peuvent ensuite être placés comme clips audio dans
la timeline.

## Contenu minimal d'une ressource `session-render`

Première structure conceptuelle :

- `version`
- `sourceSessionId`
- `sourceSessionName`
- `sourceSessionRevision`
- `createdAt`
- `renderedAt`
- `audioPayload`

Remarque d'implémentation :

- le type `session-render` peut être stocké explicitement ;
- ou être déduit de la présence d'une métadonnée `sessionRender` / `sessionRenderLink`
  attachée à la ressource ;
- l'implémentation actuelle suit cette deuxième forme.

Le `sourceSessionRevision` doit permettre de comparer :

- l'état ayant servi au rendu ;
- et l'état courant de la session source si elle existe encore dans le
  workspace.

Première décision :

- `sourceSessionRevision` doit être la valeur de `sessionRevision` de la
  session source au moment du rendu
- cette révision est une **empreinte dérivée du `SessionDocument`**, pas un
  simple numéro incrémental

## États de lien et de synchronisation

Une ressource `session-render` peut porter un état dérivé visuellement utile.

Première distinction :

- `linked`
- `unlinked`

Une ressource est `linked` si :

- la session source existe encore dans le workspace local sous le même
  `sourceSessionId`.

Une ressource est `unlinked` si :

- la session source n'existe plus dans le workspace local ;
- ou si la ressource provient d'un import qui n'a plus de source locale
  exploitable.

Deuxième distinction :

- `up-to-date`
- `stale`

Une ressource est `up-to-date` si :

- la session source existe encore ;
- et son état courant correspond à `sourceSessionRevision`.

Une ressource est `stale` si :

- la session source existe encore ;
- mais son état courant a évolué depuis le rendu utilisé par la ressource.

Conséquence UX :

- les clips issus de `session-render` doivent avoir une identité visuelle
  distincte ;
- la différence ne doit pas reposer sur la couleur seule ;
- un indicateur d'état, par exemple un badge ou un texte de statut, doit
  compléter cette distinction :
  `linked`, `unlinked`, `up-to-date`, `stale`.

## Ouverture de la session source

Les clips issus d'une ressource `session-render` doivent permettre de remonter
facilement vers leur session d'origine.

Première décision UX :

- l'action apparaît dans le **menu contextuel du clip**
- le libellé recommandé est `Open Source Session`
- cette action n'apparaît que pour un clip issu d'une ressource
  `session-render`
- cette action n'est disponible que si la ressource est actuellement
  `linked`

Comportement :

- l'action ne doit pas provoquer un switch de la session courante dans
  l'onglet actif
- elle doit ouvrir la session source dans un **nouvel onglet**
- l'URL cible est la navigation standard vers
  `?session=<sourceSessionId>`

Conséquence :

- un clip `unlinked` n'expose pas cette action
- un clip `linked` mais `stale` l'expose quand même, car la session source
  reste navigable

## Mise à jour depuis la session source

Un clip issu d'une ressource `session-render` doit pouvoir être mis à jour
depuis la dernière version de sa session source lorsque celle-ci existe encore
dans le workspace et que le rendu n'est plus synchronisé.

Première décision UX :

- l'action apparaît dans le **menu contextuel du clip**
- le libellé recommandé est `Update From Source Session`
- cette action n'apparaît que pour un clip issu d'une ressource
  `session-render`
- cette action n'est disponible que si le clip est à la fois :
  - `linked`
  - `stale`

Comportement :

- l'action rerend la session source à sa révision courante
- l'action crée une **nouvelle ressource globale** de type `session-render`
- cette nouvelle ressource remplace seulement la ressource du **clip ciblé**
- les autres clips éventuellement issus d'un rendu plus ancien ne sont pas
  modifiés

Conséquence importante :

- l'update est **clip-local**
- il ne doit pas produire d'effet de bord global sur d'autres clips partageant
  une ressource antérieure

Gestion de la durée :

- le début du clip ne change pas
- si la nouvelle durée est plus longue :
  - le clip est étendu
  - les clips suivants sur la même piste sont repoussés vers la droite juste
    assez pour éviter tout recouvrement
- si la nouvelle durée est plus courte :
  - le clip est raccourci
  - les clips suivants ne sont pas automatiquement rapprochés

Undo / Redo :

- toute l'opération doit être undoable en **une seule transformation**
- cette transformation inclut :
  - la création de la nouvelle ressource
  - le remplacement de la ressource du clip ciblé
  - la mise à jour éventuelle de sa durée
  - le repositionnement éventuel des clips suivants

## Token de drag

Le drag&drop inter-sessions utilise un token opaque, par exemple :

- UUID
- ou autre identifiant temporaire équivalent

Ce token est écrit dans `DataTransfer`, par exemple sous un type custom :

```text
application/x-webdaw-session-render
```

Le token permet à la cible de retrouver le payload localement.

## Durée de vie des payloads temporaires

Les payloads temporaires de drag inter-sessions sont temporaires.

Ils doivent pouvoir expirer automatiquement.

Première règle :

- un payload est supprimable dès qu'il a été consommé ;
- à défaut, il doit expirer après un délai raisonnable ;
- un nettoyage opportuniste est acceptable.

## Sémantique du drop

Le drop inter-sessions doit être pensé d'abord comme une **copie**.

Première décision :

- drag&drop inter-sessions = copie par défaut

La notion de "move entre sessions" peut être ajoutée plus tard, mais elle est
plus complexe :

- elle couple deux sessions ;
- elle pose la question de l'undo dans la source et dans la cible ;
- elle demande une transaction inter-sessions.

Donc la première version doit rester :

- simple
- locale
- asymétrique
- copie-only

## Import dans la session cible

Au `drop`, la cible doit :

1. lire le token
2. charger le payload `session-render`
3. créer ou résoudre une ressource audio de type `session-render`
4. importer les données audio rendues si nécessaire
5. créer un clip dans la session cible comme pour un drop de ressource audio
6. appliquer le placement de drop

Le remapping des ressources doit éviter toute collision locale d'identifiants.

## Undo / Redo et drag inter-sessions

Le drag&drop inter-sessions doit être undoable dans la **session cible**.

Première règle :

- l'import du fragment est une seule opération éditoriale undoable côté cible

En revanche, comme la première version est une copie :

- aucune mutation n'a lieu dans la source ;
- donc rien n'est à undo côté source.

## Drag de clips simples entre sessions

Le drag&drop de clips simples entre deux sessions ouvertes n'est pas le premier
objectif.

Il est explicitement différé car :

- il entre en conflit gestuel avec l'autopan intra-timeline ;
- il demande une sérialisation plus fine de fragments de clips ;
- il est moins structurant que la possibilité de réutiliser immédiatement une
  session comme ressource hiérarchique.

Il reste une extension possible plus tard.

## Export `.zip` et multi-sessions

Le workspace multi-sessions ne remplace pas l'export `.zip`.

Les deux mécanismes ont des rôles distincts :

- le workspace local permet le travail quotidien et le multi-fenêtres ;
- le `.zip` sert à l'archivage, au partage et au transport hors navigateur.

## Conséquence architecturale

Nous devons distinguer explicitement :

1. le **document de session**
2. la **copie locale de travail d'une session ouverte**
3. le **registre des sessions ouvertes**
4. le **fragment temporaire inter-sessions**
5. l'**état runtime d'une fenêtre**

Cette distinction est essentielle pour éviter de confondre :

- persistance locale longue durée ;
- autosave ;
- export ;
- transport temporaire de drag.

## Première décision

Le navigateur héberge un **workspace local multi-sessions** composé des
sessions actuellement ouvertes.

Ce workspace persiste de façon à être retrouvé si la page est fermée puis
rouverte.

## Deuxième décision

Une fenêtre du DAW ouvre une session précise et peut switcher entre plusieurs
sessions ouvertes de son workspace.

Le cas nominal multi-fenêtres est :

- fenêtres différentes
- sessions différentes

## Troisième décision

Le drag&drop inter-sessions repose sur des **fragments temporaires stockés
localement**, référencés par token dans `DataTransfer`.

## Quatrième décision

La première version du drag&drop inter-sessions est une **copie**, pas un
déplacement.

## Point ouvert

Il reste à préciser plus tard :

- la forme exacte du `sessionId` ;
- le schéma précis du registre local des sessions ouvertes ;
- le backend local concret ;
- la forme exacte du fragment temporaire ;
- la stratégie de nettoyage des fragments expirés ;
- la politique pour "la même session ouverte dans plusieurs fenêtres" ;
- la forme exacte de l'ouverture explicite d'une session ;
- l'interface utilisateur de sélection, création, fermeture et renommage des
  sessions.
