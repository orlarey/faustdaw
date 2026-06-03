# Spécification undo / redo

## Introduction

Un _éditeur_ est un logiciel interactif qui permet à l'utilisateur d'éditer des _documents_ au moyen d'_outils_. Une session de travail peut être vue comme une trajectoire dans l'espace des documents : chaque utilisation d'outil fait passer d'un document à un autre.

Il est utile qu'un éditeur dispose d'un système de _undo / redo_ permettant de défaire et refaire les opérations réalisées sur le document. Faire un _undo_ revient à remonter d'un cran dans la trajectoire et à revenir à l'état immédiatement précédent du document. Un _redo_ effectue le mouvement inverse : il avance le curseur sur une trajectoire déjà existante.

Plus généralement, une action appliquée au document courant produit un document. Si ce document appartient déjà à la trajectoire courante, l'action déplace simplement le curseur vers ce point. Si ce document n'appartient pas à la trajectoire courante, l'action crée une bifurcation à partir du document courant et ouvre une nouvelle trajectoire.

Supposons maintenant que les outils soient eux-mêmes hautement configurables, au point que la configuration d'un outil puisse être considérée comme un méta-document, et que l'utilisateur puisse tester et faire évoluer ce méta-document à l'aide de méta-outils. Que devient alors le système de _undo / redo_ ?


## Cadrage

Modèle d'undo / redo pour un système composé d'**outils imbriqués** : un outil peut intégrer d'autres outils dans son fonctionnement. Objectif : un comportement undo / redo cohérent et compositionnel à toutes les profondeurs.

## Principe

Chaque instance d'outil possède son propre **scope d'undo / redo**. Un scope
contient une trajectoire locale dans l'espace des états observables de cette
instance, ainsi qu'un curseur sur cette trajectoire. Les piles `past` et
`future` sont la représentation linéaire de la branche courante autour de ce
curseur. Une action y est enregistrée **si et seulement si** elle modifie
l'état observable de cette instance d'outil.

L'**état observable** d'un outil est l'état que l'utilisateur peut percevoir ou
réutiliser à ce niveau. Dans un outil de configuration, les paramètres courants
sont observables localement. Dans l'outil parent, ces réglages internes ne sont
pas observables comme actions du parent ; seul le résultat appliqué au parent
l'est.

L'utilisation d'un outil de niveau $N+1$ par un outil de niveau $N$ se décompose en deux phases :

- **Configuration interne** de l'outil $N+1$ — ne change pas l'état au niveau $N$. Enregistrée dans la pile $N+1$.
- **Application** de l'outil $N+1$ — change l'état au niveau $N$ en y reportant le résultat de la configuration courante. Enregistrée dans la pile $N$.

L'application est la **frontière de commit** entre les deux niveaux. Elle
transmet au parent un **snapshot de configuration** : une valeur figée,
suffisante pour défaire et refaire l'application, et non une référence vivante
vers l'état interne de l'outil enfant.

Une même session de configuration peut produire plusieurs applications successives. Chacune est une entrée distincte dans la pile $N$ ; les ajustements de configuration qui les ont préparées restent dans la pile $N+1$.

Exemple canonique :

```text
Scope niveau 0:
  past:
    ApplyTool1(config = C1, result = R1)
    ApplyTool1(config = C2, result = R2)
  future:
    -

Scope de l'instance Tool1:
  past:
    ChangeParam(a = 0.2)
    UseTool2(...)
    ChangeParam(a = 0.6)
  future:
    -
```

Si le focus est au niveau 0, deux commandes undo défont
`ApplyTool1(C2)` puis `ApplyTool1(C1)`. Elles ne défont pas
`ChangeParam(a = 0.6)` ni `UseTool2(...)`, car ces actions appartiennent au
scope de l'instance `Tool1`.

## Règles

1. **Indépendance.** Un undo dans un outil ne touche aucune autre pile, supérieure ou inférieure.
2. **Persistance.** Quitter un outil n'efface pas sa pile ; on la retrouve telle quelle au retour.
3. **Routage par focus.** La commande undo / redo s'applique à l'outil qui a le focus.
4. **Non-référence par identité entre niveaux.** Une action de niveau $N$ ne référence pas par identité une entité produite à un autre niveau ; elle copie par valeur ce dont elle a besoin. Sans cette propriété, défaire une création à un niveau invaliderait des entrées à un autre niveau et la composition cesserait d'être propre.
5. **Fermeture et retour de focus.** Fermer ou quitter un outil rend le focus à son parent. Les commandes undo / redo suivantes agissent donc sur le scope du parent. Rouvrir l'outil restaure son scope interne s'il s'agit de la même instance persistante.
6. **Instance plutôt que classe.** Deux instances différentes du même type d'outil possèdent deux scopes distincts, sauf si le produit définit explicitement un outil global partagé.
7. **Bifurcation locale.** Une action enregistrée dans un scope n'invalide pas la trajectoire par le seul fait qu'elle est nouvelle. Elle produit un nouvel état observable. Si cet état appartient à la trajectoire courante du scope, le curseur avance vers ce point et la trajectoire est conservée. Si cet état n'appartient pas à cette trajectoire, l'action crée une bifurcation locale à partir de l'état courant.
8. **Politique de branches.** La gestion concrète d'une bifurcation dépend du modèle d'historique choisi. Dans un modèle linéaire, la nouvelle branche remplace la pile `future` du scope courant. Dans un modèle arborescent, les anciennes branches peuvent être conservées. Dans tous les cas, l'effet reste local au scope concerné et ne se propage pas aux autres scopes.

## Conséquence

L'historique d'undo / redo prend la forme d'un **arbre de scopes**, un par instance d'outil actif ou persistante. Chaque scope contient sa propre trajectoire locale, stable face aux opérations des autres scopes. Le mental model utilisateur est uniforme à toutes les profondeurs : *ici, undo défait ce que je viens de faire ici*.

## Hors-scope

- Stratégie de stockage des entrées (snapshot complet, diff, command pattern).
- Profondeur maximale, éviction, persistance long terme entre sessions.
- Politique de conservation et de navigation entre branches multiples — extension orthogonale, applicable indépendamment à chaque scope.
