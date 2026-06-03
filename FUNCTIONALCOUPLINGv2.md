# Guide de couplage fonctionnel (v2)

## Cadrage

**Objectif.** Produire du code **lisible et compréhensible par un lecteur humain**. Pas du code rapide, pas du code court, pas du code « propre » au sens abstrait. Du code où un lecteur peut construire un modèle mental fiable, concept par concept, sans devoir sauter d'un fichier à l'autre pour comprendre.

**Public.** Ce guide s'adresse à un agent producteur de code. Son destinataire final est le lecteur humain ; toutes les règles ci-dessous en découlent.

**Méthode.** Pour atteindre cet objectif, ce guide définit un principe de **clustering hiérarchique par co-usage**, sous contrainte d'acyclicité des dépendances entre concepts.

Il ne prescrit pas une décomposition unique et ne constitue pas un algorithme. Son rôle est de **discipliner le jugement** par une métrique explicite et des tests de validation. Le jugement ne peut pas être éliminé ; il peut être rendu plus rigoureux.

## Principe

Un **concept** regroupe des données et des opérations dont la co-utilisation interne est plus forte que la co-utilisation externe. La forme canonique est la classe (type + opérations), mais le même critère s'applique à toute granularité — d'un type jusqu'à un dossier.

Un programme bien structuré forme un **DAG de concepts** :

- chaque concept a une forte cohésion interne,
- les dépendances entre concepts sont explicites et unidirectionnelles,
- aucun cycle entre concepts pairs.

## La métrique : le co-usage

La métrique opérationnelle est le **co-usage dans les signatures**, mesurable par inspection du code :

- **Groupes de paramètres récurrents** — des paramètres qui voyagent toujours ensemble suggèrent un type.
- **Champs lus ensemble** — des champs qui apparaissent dans les mêmes opérations suggèrent une unité.
- **Imports groupés** — des symboles toujours importés ensemble par plusieurs consommateurs suggèrent un fichier ou un dossier.

On ne groupe pas par similarité thématique, ni par co-changement de valeurs au runtime (souvent redondant ou incident).

## Les niveaux

La même métrique s'applique à toutes les granularités. Chaque niveau est un « niveau de coupe » du dendrogramme :

- **Type** — des champs co-utilisés forment un type.
- **Classe (type + opérations)** — un type et les fonctions qui accèdent principalement à ses données, **co-localisés dans le même fichier** (ou, à défaut, dans un dossier dédié au type). Un type séparé de ses opérations n'a pas de grammaire lisible : le lecteur doit chercher ailleurs ce qu'il peut en faire, et la cohésion du concept disparaît. **Une bonne classe forme une mini-grammaire : chaque opération publique occupe l'un de trois rôles — introduction (construit un `T`), combinateur (combine des `T` en `T`), terminal (consomme un `T` pour produire autre chose). Une opération qui ne rentre dans aucun rôle est probablement un cas particulier à décomposer.** Test : (1) les opérations accèdent-elles surtout aux données internes du type ? (2) chaque opération publique occupe-t-elle un rôle grammatical clair ? Si non, la frontière ou la conception est mal placée.
- **Fichier** — des types, classes et fonctions co-importés par les mêmes consommateurs forment un fichier.
- **Dossier** — des fichiers à fort référencement mutuel forment un dossier.

La contrainte d'acyclicité s'applique à chaque niveau : pas de cycle entre types, classes, fichiers pairs, ou dossiers pairs.

## Tests de validation

**Test de documentation.** Le concept peut-il être décrit en une ou deux phrases, sans énumération ni qualifications excessives ? Si non, la frontière coupe probablement à travers plusieurs préoccupations.

**Test du cherry-picking.** Les consommateurs externes utilisent-ils la plupart des exports de ce fichier, ou un fragment disjoint ? Si un consommateur A utilise `{a, b, c}` et un consommateur B utilise `{d, e}` sans recoupement, ce sont probablement deux concepts qui partagent un fichier par accident.

## Anti-patterns

- **Cycles** entre concepts pairs — signale une frontière mal placée : fusionner, redécouper, ou factoriser via un concept tiers.
- **Regroupement thématique** — grouper par similarité de nom ou de domaine sans co-usage réel.
- **Sur-abstraction** — introduire un concept pour une donnée utilisée par une seule opération, ou jamais répétée dans les signatures.
- **Code mort** — champs stockés mais jamais lus, exports jamais importés. Symptôme d'une frontière qui a dérivé. À utiliser comme signal de diagnostic, pas seulement comme bruit à nettoyer.
- **Couplage caché par état module partagé** — callbacks globaux, variables mutables enregistrées depuis l'extérieur. À traiter comme des arêtes du DAG, même si elles n'apparaissent pas dans les imports.
- **Type séparé de ses opérations** — définir un type dans un fichier et ses opérations principales ailleurs (souvent un catch-all multi-types). Le type devient une donnée orpheline, sa grammaire invisible au lecteur. Symptôme fréquent : un fichier `daw.ts`, `core.ts`, `api.ts` qui agrège les opérations de plusieurs types.

## Audit d'un fichier existant

Procédure de diagnostic quand on se demande si un fichier est bien découpé :

1. Lister les exports du fichier.
2. Pour chaque consommateur externe, recenser le sous-ensemble d'exports qu'il utilise.
3. Chercher des **sous-ensembles disjoints** : deux consommateurs qui utilisent des parties non recouvrantes révèlent généralement deux concepts distincts.
4. Pour chaque type exporté, identifier les champs jamais lus (morts).
5. Pour chaque export, vérifier s'il est réellement importé quelque part (morts sinon).
6. Repérer l'état module mutable et les callbacks enregistrés depuis l'extérieur : ce sont des couplages invisibles au graphe d'imports.

Le code mort trouvé par cette procédure est un indice fort de dérive. Il précède souvent le bon redécoupage.

## Construction ab initio

Quand on conçoit un nouveau module :

1. Identifier les données manipulées par les opérations envisagées.
2. Repérer les paramètres ou champs qui co-apparaissent dans la majorité des signatures.
3. Introduire un concept pour chaque groupement stable à forte co-utilisation interne et faible co-utilisation externe.
4. Ne pas introduire de concept pour une donnée qui n'apparaît qu'une fois.
5. Si une fonction touche plusieurs concepts, la traiter comme point d'orchestration — pas comme révélation d'un nouveau concept.
6. Ajuster les signatures pour refléter les concepts émergés, puis vérifier avec les deux tests de validation.
