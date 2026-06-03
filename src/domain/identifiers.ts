/**
 * Purpose: Define the fundamental identifier types shared by the domain model.
 * How: Represent each identifier as a nominally distinct string alias at the type level while keeping runtime values simple.
 */
/**
 * Purpose: Identify one project instance in the domain.
 * How: Alias project identifiers to strings so higher-level records can refer to a project without importing heavier concepts.
 */
export type ProjectId = string;

/**
 * Purpose: Identify one imported audio resource in the project catalog.
 * How: Alias resource identifiers to strings so resources remain referentially lightweight across the domain.
 */
export type ResourceId = string;

/**
 * Purpose: Identify one clip placed in the timeline.
 * How: Alias clip identifiers to strings so tracks and outputs can refer to clips without owning their full payload.
 */
export type ClipId = string;
