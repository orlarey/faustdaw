# Guide de couplage fonctionnel (v3)

## Cadrage

**Objectif.** Produire du code **lisible et compréhensible par un lecteur humain**. Pas du code rapide, pas du code court, pas du code « propre » au sens abstrait. Du code où un lecteur peut construire un modèle mental fiable, concept par concept, sans devoir sauter d'un fichier à l'autre pour comprendre.

**Public.** Ce guide s'adresse à un agent producteur de code. Son destinataire final est le lecteur humain ; toutes les règles ci-dessous en découlent.

**Méthode.** Pour atteindre cet objectif, ce guide définit un principe de **clustering hiérarchique par co-usage**, sous contrainte d'acyclicité des dépendances, **et d'honnêteté du graphe d'imports vis-à-vis du graphe d'exécution réel**.

Il ne prescrit pas une décomposition unique et ne constitue pas un algorithme. Son rôle est de **discipliner le jugement** par une métrique explicite et des tests de validation. Le jugement ne peut pas être éliminé ; il peut être rendu plus rigoureux.

## Principe

Un **concept** regroupe des données et des opérations dont la co-utilisation interne est plus forte que la co-utilisation externe. La forme canonique couple type et opérations dans une même unité — réalisée de préférence par une classe, avec repli possible sur type + fonctions libres co-localisées (voir « Les niveaux » et le test de lecture au coup d'œil). Le même critère de co-utilisation s'applique à toute granularité — d'un type jusqu'à un dossier.

Un programme bien structuré forme un **DAG de concepts honnête** :

- chaque concept a une forte cohésion interne,
- les dépendances entre concepts sont explicites, unidirectionnelles, et **visibles dans le graphe d'imports**,
- aucun cycle entre concepts pairs.

L'honnêteté est cruciale : toute exécution de code dans une direction non visible dans les imports (callback injecté, variable module enregistrée depuis l'extérieur, event bus) constitue une **arête cachée** qui fait mentir le DAG. Un graphe qui paraît acyclique peut être un cycle déguisé.

## Hiérarchie des dépendances

Du point de vue de la lisibilité d'un concept isolé, toutes les dépendances ne se valent pas :

| Type | Arête dans le DAG | Lisibilité locale |
|---|---|---|
| Aucune dépendance | — | Parfaite |
| **Import direct d'une abstraction stable** | Visible, statique | Excellente — nommée, jump-to-definition marche |
| **Callback injecté (via `ctx`, registry, event bus)** | **Cachée** | Dégradée — opaque, il faut sortir du concept pour comprendre |
| État module mutable partagé | **Cachée** | Anti-pattern — invisible |

Les callbacks et l'état partagé sont deux formes du même problème : ils permettent au code d'appeler dans une direction non déclarée. **Un callback injecté est catégoriquement inférieur à un import direct** : il force le lecteur à sortir du concept pour savoir ce qui est réellement appelé.

## La métrique : le co-usage

La métrique opérationnelle est le **co-usage dans les signatures**, mesurable par inspection du code :

- **Groupes de paramètres récurrents** — des paramètres qui voyagent toujours ensemble suggèrent un type.
- **Champs lus ensemble** — des champs qui apparaissent dans les mêmes opérations suggèrent une unité. **Le test s'applique aussi à l'intérieur d'une structure existante** : un sous-ensemble de champs d'un bag partagé toujours accédé ensemble par les mêmes opérations constitue un concept qui mérite son propre sous-type — même si la structure englobante existe pour d'autres raisons. Sans cet ancrage côté données, les opérations peuvent être bien groupées par concept tandis que l'entité qu'elles manipulent reste invisible.
- **Imports groupés** — des symboles toujours importés ensemble par plusieurs consommateurs suggèrent un fichier ou un dossier.

On ne groupe pas par similarité thématique, ni par co-changement de valeurs au runtime (souvent redondant ou incident).

## Les niveaux

La même métrique s'applique à toutes les granularités. Chaque niveau est un « niveau de coupe » du dendrogramme :

- **Type** — des champs co-utilisés forment un type.
- **Classe (type + opérations)** — un type et les fonctions qui accèdent principalement à ses données, **co-localisés dans le même fichier** (ou, à défaut, dans un dossier dédié au type). Un type séparé de ses opérations n'a pas de grammaire lisible : le lecteur doit chercher ailleurs ce qu'il peut en faire, et la cohésion du concept disparaît. **Une bonne classe forme une mini-grammaire : chaque opération publique occupe l'un de trois rôles — introduction (construit un `T`), combinateur (combine des `T` en `T`), terminal (consomme un `T` pour produire autre chose). Une opération qui ne rentre dans aucun rôle est probablement un cas particulier à décomposer.** Test : (1) les opérations accèdent-elles surtout aux données internes du type ? (2) chaque opération publique occupe-t-elle un rôle grammatical clair ? Si non, la frontière ou la conception est mal placée. **Deux réalisations possibles, pas équivalentes en lisibilité** : *vraie classe* (méthodes listées dans le corps de la classe) ou *type + fonctions libres co-localisées* (opérations exportées du même fichier). La vraie classe est **strictement supérieure en lisibilité** et doit être préférée par défaut. Deux critères concrets poussent vers type + fonctions comme dégradation acceptable :
  - **Sérialisation structurelle plate** — le concept doit survivre à un round-trip JSON sans réhydratation d'instance.
  - **Coût d'idiome du langage sur l'immuabilité** — certains langages (notamment TypeScript/JavaScript) n'ont pas de copie partielle native pour les classes : le spread operator perd le prototype, chaque champ modifiable doit avoir sa méthode `with*`. Pour un value-type immuable fréquemment mis à jour par copie, type + fonctions libres devient le pattern idiomatique. Dans les langages avec copie native (Scala `.copy()`, Kotlin `data class`, Rust struct update), ce coût disparaît et la classe reste préférable.

  Ces critères sont **des raisons de dégrader, pas des interdictions de classe** : l'immuabilité seule, ou l'embarquement dans un conteneur plus grand, ne justifie pas de renoncer à la classe. Les records Java, case classes Scala, data classes Kotlin sont immuables et embarquées, et restent des classes. Un concept embarqué mais avec des opérations intrinsèques claires (une note dans une séquence MIDI avec `note.transpose(5)`) mérite d'être une classe même si la séquence qui la contient en est une aussi.

  **Convention de surface (TypeScript) :** réserver `interface` aux contrats réellement implémentés par une classe (`class X implements Foo`). Pour toute autre forme de données — records, paramètres, résultats, configs — utiliser `type Foo = { ... }`. Le mot `interface` en TypeScript est trompeur (il peut décrire n'importe quel shape) ; cette convention aligne la surface du code avec le sens OOP classique d'« interface ».
- **Fichier** — des types, classes et fonctions co-importés par les mêmes consommateurs forment un fichier.
- **Dossier** — des fichiers à fort référencement mutuel forment un dossier.

La contrainte d'acyclicité s'applique à chaque niveau : pas de cycle entre types, classes, fichiers pairs, ou dossiers pairs.

## Tests de validation

**Test de documentation.** Le concept peut-il être décrit en une ou deux phrases, sans énumération ni qualifications excessives ? Si non, la frontière coupe probablement à travers plusieurs préoccupations.

**Test de lecture au coup d'œil.** Un lecteur qui ouvre le fichier du concept voit-il en un seul coup d'œil la liste complète de ses opérations publiques ? Avec une classe, oui — le corps de la classe *est* cette interface, champs et méthodes rangés ensemble. Avec un type + fonctions libres co-localisées, non — il faut parcourir tout le fichier pour reconstituer la liste, et rien ne montre l'interface à un endroit. **Conséquence :** préférer la classe par défaut ; ne reculer vers type + fonctions que si l'un des deux critères de dégradation (sérialisation plate, coût d'idiome du langage) s'applique — voir la puce « Classe » des niveaux.

**Test contrat vs bag (pour un record avec champs-fonction).** Un record qui mélange data et méthodes peut être soit un *contrat* (plusieurs types concrets l'implémentent, chaque implémentation documente explicitement son engagement via `implements`), soit un *bag de callbacks* (un seul site construit une config au vol pour un consommateur unique). Les deux sont différents : le contrat justifie classe + interface, le bag justifie type + object literal. Symptôme du contrat déguisé en bag : plusieurs sites construisent des objets littéraux de même forme — c'est en fait la même abstraction qu'une classe exprimerait via `implements`.

**Test du cherry-picking (côté consommateur).** Les consommateurs externes utilisent-ils la plupart des exports de ce fichier, ou un fragment disjoint ? Si un consommateur A utilise `{a, b, c}` et un consommateur B utilise `{d, e}` sans recoupement, ce sont probablement deux concepts qui partagent un fichier par accident.

**Test de la surface de couplage (côté producteur).** Quand on extrait un concept X d'un fichier hôte F, compter les callbacks et services que F doit *injecter* dans X pour qu'il fonctionne. Chaque callback injecté est une **arête cachée** (X appelle du code de F sans l'importer). À traiter comme une dette :
- **0-3** — concept autonome, extraction clean.
- **4-7** — couplage modéré, acceptable s'il est structurel.
- **8+** — alerte : soit F cache un sous-concept à extraire d'abord, soit X est en fait plusieurs concepts.

**Cherry-picking et surface de couplage mesurent la même chose** — la taille de l'interaction entre un concept et son environnement — vues de deux côtés. Un concept bien découpé a une petite surface dans les deux directions.

**Objectif à long terme : éliminer les callbacks en les remplaçant par des imports directs** du concept qui est leur vraie source. Les callbacks sont un état transitoire de refactor, pas une destination.

## Anti-patterns

- **Cycles visibles** entre concepts pairs — signale une frontière mal placée : fusionner, redécouper, ou factoriser via un concept tiers.
- **Cycles cachés** via callback, registry, event bus, ou état module partagé — un cycle maquillé en arbre. À traiter comme un cycle réel.
- **Regroupement thématique** — grouper par similarité de nom ou de domaine sans co-usage réel.
- **Sur-abstraction** — introduire un concept pour une donnée utilisée par une seule opération, ou jamais répétée dans les signatures.
- **Code mort** — champs stockés mais jamais lus, exports jamais importés. Symptôme d'une frontière qui a dérivé. À utiliser comme signal de diagnostic.
- **Type séparé de ses opérations** — définir un type dans un fichier et ses opérations principales ailleurs (souvent un catch-all multi-types). Le type devient une donnée orpheline, sa grammaire invisible. Symptôme fréquent : un fichier `daw.ts`, `core.ts`, `api.ts` qui agrège les opérations de plusieurs types.
- **Concept dispersé dans un état partagé** — les opérations d'un concept sont correctement regroupées dans leurs modules, mais les champs qu'elles manipulent restent à plat dans une structure englobante (état global, bag de contexte). La cohésion existe côté opérations mais pas côté données. Test : peut-on répondre à « quel est l'état actuel de X ? » en lisant un seul endroit ? Si la réponse demande l'union de N champs dispersés, X n'a pas d'ancrage dans les données et son nom n'est qu'une convention de préfixe.
- **Callbacks persistants** — une surface de couplage > 0 après extraction signale une dette de refactor. Chaque callback devrait finir par être remplacé par un import direct d'un concept stable.
- **Constructeur en deux temps** — un `initX(data)` qui stocke `data` dans une variable module, suivi d'un `buildX()` qui la lit avec garde « n'a pas été appelé ». Trois problèmes cumulés : état module mutable, arête cachée dans le DAG (la donnée arrive hors-imports), et contrainte d'ordre temporel documentée par un `throw`. Fusionner en `wireX(data)` : un seul appel, donnée visible dans la signature, contrainte portée par le type-system.
- **Couche wrapper sans consommateur indépendant** — une couche A qui oriente essentiellement des appels vers une couche B sous-jacente, non testée seule, non consommée hors du chemin A→B. Candidat à la fusion. Test : supprimer A et recenser ce qui perdait de la valeur. Si rien, collapser A dans B (ou dans les consommateurs de A).

## Audit d'un fichier existant

Procédure de diagnostic quand on se demande si un fichier est bien découpé :

1. Lister les exports du fichier.
2. Pour chaque consommateur externe, recenser le sous-ensemble d'exports qu'il utilise.
3. Chercher des **sous-ensembles disjoints** : deux consommateurs qui utilisent des parties non recouvrantes révèlent généralement deux concepts distincts.
4. Pour chaque type exporté, identifier les champs jamais lus (morts).
5. Pour chaque export, vérifier s'il est réellement importé quelque part (morts sinon).
6. Repérer l'état module mutable et les callbacks enregistrés depuis l'extérieur : ce sont des arêtes cachées du DAG.
7. Pour chaque structure partagée (état global, bag de contexte), appliquer le test de co-usage à ses **champs** : les sous-ensembles systématiquement accédés ensemble par les mêmes opérations doivent devenir des sous-types nommés.

Le code mort trouvé par cette procédure est un indice fort de dérive. Il précède souvent le bon redécoupage.

**Ordre d'extraction** : sur un fichier monolithique, extraire par ordre croissant de surface de couplage prévue. Les closures isolées (surface faible) d'abord ; les clusters entrelacés ensuite. Chaque extraction crée des coutures qui permettent aux extractions suivantes de réduire leur propre surface (certains callbacks deviennent alors des imports directs).

## Construction ab initio

Quand on conçoit un nouveau module :

1. Identifier les données manipulées par les opérations envisagées.
2. Repérer les paramètres ou champs qui co-apparaissent dans la majorité des signatures.
3. Introduire un concept pour chaque groupement stable à forte co-utilisation interne et faible co-utilisation externe.
4. Ne pas introduire de concept pour une donnée qui n'apparaît qu'une fois.
5. Si une fonction touche plusieurs concepts, la traiter comme point d'orchestration — pas comme révélation d'un nouveau concept.
6. Pour chaque concept introduit, choisir sa forme : **classe** dès que l'état peut vivre dans l'instance (réalisation préférée — voir « Test de lecture au coup d'œil »), **type + fonctions libres co-localisées** seulement quand l'état doit vivre ailleurs (conteneur central, value-type, sérialisation plate).
7. Ajuster les signatures pour refléter les concepts émergés, puis vérifier avec les tests de validation (documentation, lecture au coup d'œil, cherry-picking, surface de couplage).

Préférer toujours **un import direct d'un concept nommé** à un callback injecté — même si cela demande d'extraire plus de concepts que prévu initialement.
