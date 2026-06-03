# Clip Placement Specification

## Problem

On veut spécifier le comportement de drop d'un clip dans une piste qui peut déjà contenir plusieurs clips non chevauchants.

Le problème apparaît quand le clip droppé vise une position où l'espace vide n'est pas suffisant.

On note :

- `C*` le clip que l'on drop ;
- `s*` la date de début demandée par le drop ;
- `d*` la durée de `C*` ;
- `e* = s* + d*` sa date de fin ;
- `P` le clip immédiatement précédent dans la piste cible ;
- `N` le clip immédiatement suivant dans la piste cible ;
- `end(P)` la fin de `P` ;
- `start(N)` le début de `N`.

Le but est de définir la règle de placement la plus simple possible.

## Principle

Le clip droppé cherche d'abord à respecter la position demandée.

Si cette position n'est pas valide, alors :

- on cherche la position valide la plus naturelle localement ;
- puis on décale vers la droite les clips suivants si cela est nécessaire.

## Cases

### 1. Free Drop

S'il y a assez de place au point de drop, le clip est posé exactement à la position demandée.

Condition :

```math
end(P) <= s*
and
e* <= start(N)
```

Schéma :

```text
... [P]          drop C*          [N] ...
            ->   [C*]
```

Règle :

```math
place(C*) at s*
```

### 2. Blocked Behind

S'il n'y a pas assez de place derrière le clip droppé, mais que son début demandé reste valide par rapport au clip précédent, alors on garde la position demandée et on décale tous les clips suivants vers la droite autant que nécessaire.

Condition :

```math
end(P) <= s*
and
e* > start(N)
```

Schéma :

```text
... [P]      drop C*    [N] [N2] ...
        ->   [C*]          [N] [N2] ...
```

Règle :

```math
place(C*) at s*
shift every following clip right by the minimal required amount
```

### 3. Blocked Ahead

S'il n'y a pas assez de place devant le clip droppé, alors on ne garde pas exactement la position demandée. On aligne le début du clip droppé sur la fin du clip précédent.

Condition :

```math
end(P) > s*
and
end(P) + d* <= start(N)
```

Schéma :

```text
... [P]drop C*        [N] ...
    -> [C*]
```

Règle :

```math
place(C*) at end(P)
```

### 4. Insertion

S'il n'y a pas assez de place ni devant ni derrière, alors on insère le clip :

- on cale son début sur la fin du clip précédent ;
- puis on décale tous les clips suivants vers la droite autant que nécessaire.

Condition :

```math
end(P) > s*
and
end(P) + d* > start(N)
```

Schéma :

```text
... [P]drop C*[N] [N2] ...
    -> [C*]   [N] [N2] ...
```

Règle :

```math
place(C*) at end(P)
shift every following clip right by the minimal required amount
```

## Compact Form

On peut résumer les règles ainsi :

- cas libre : on drop à la position demandée ;
- cas bloqué par l'arrière : on garde la position demandée et on pousse ce qui suit ;
- cas bloqué par l'avant : on se colle au clip précédent ;
- cas bloqué des deux côtés : on s'insère après le clip précédent et on pousse ce qui suit.

## Remarks

Cette spécification ne décide pas encore :

- comment choisir `P` et `N` quand le drop vise exactement une frontière ;
- comment le comportement se combine avec le magnétisme ;
- comment traiter le changement de piste ;
- comment visualiser à l'avance l'insertion et les décalages induits.

Ces points feront l'objet de raffinements ultérieurs.
