#!/bin/bash
#
# OCI Container Build Script with Multi-Language Support
#
# This script automatically extracts metadata from project configuration files
# (package.json, pyproject.toml, Cargo.toml, etc.) and generates OCI-compliant
# container image labels.
#
# ==============================================================================
# USAGE EXAMPLES
# ==============================================================================
#
# Basic Usage (auto-detect):
#   ./container.sh help
#   ./container.sh get_labels
#   ./container.sh build
#   ./container.sh inspect
#
# Explicit Project Type:
#   PROJECT_TYPE=node ./container.sh build
#   PROJECT_TYPE=python ./container.sh get_labels
#
# Advanced Usage:
#   podman build --squash \
#       --build-arg-file <(./container.sh get_labels) \
#       --build-arg CUSTOM_ARG=value \
#       -t my-app:latest .
#
# ==============================================================================

set -e

# ==============================================================================
# SECTION 1: Basic Configuration
# ==============================================================================

COMMAND="${1:-help}"
DEBUG="${DEBUG:-false}"
PROJECT_TYPE="${PROJECT_TYPE:-}"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)

# Enable bash tracing if VERBOSE is set
[[ "$VERBOSE" == "true" ]] && set -x

# ==============================================================================
# SECTION 2: Utility Functions
# ==============================================================================

function debug() {
	[[ "$DEBUG" == "true" ]] && echo "[DEBUG] $*" >&2
}

function die() {
	echo "Error: $*" >&2
	exit 1
}

function strip_json_quotes() {
	local value=$1
	value="${value#\"}"
	value="${value%\"}"
	echo "$value"
}

# ==============================================================================
# SECTION 3: Static Configuration
# ==============================================================================

declare -a OCI_LABELS=(
	"TITLE"
	"DESCRIPTION"
	"VERSION"
	"AUTHORS"
	"VENDOR"
	"LICENSES"
	"URL"
	"DOCUMENTATION"
	"SOURCE"
	"CREATED"
	"REVISION"
)

declare -A JSON_PARSERS=(
	[jq]="parse_json_with_jq"
	[node]="parse_json_with_node"
)

declare -A TOML_PARSERS=(
	[tomlq]="parse_toml_with_tomlq"
)

declare -A PARSER_TYPE_MAP=(
	[json]="JSON_PARSERS"
	[toml]="TOML_PARSERS"
)

declare -A PROJECT_PARSER_TYPE=(
	[node]="json"
	[python]="toml"
	[rust]="toml"
	[php]="json"
	[go]="toml"
)

declare -A PROJECT_METADATA_FILE=(
	[node]="package.json"
	[python]="pyproject.toml"
	[rust]="Cargo.toml"
	[php]="composer.json"
	[go]="go.mod"
)

declare -a PROJECT_DETECTION_ORDER=("node" "python" "rust" "php" "go")

declare -A NODE_FIELD_PATHS=(
	[TITLE]="name"
	[DESCRIPTION]="description"
	[VERSION]="version"
	[AUTHORS]="author"
	[VENDOR]="author"
	[LICENSES]="license"
	[URL]="homepage"
	[DOCUMENTATION]="SPECIAL:extract_documentation_from_repo"
	[SOURCE]="repository"
)

declare -A PYTHON_FIELD_PATHS=(
	[TITLE]="project.name"
	[DESCRIPTION]="project.description"
	[VERSION]="project.version"
	[AUTHORS]="project.authors[0].name|project.authors[0]"
	[VENDOR]="project.authors[0].name|project.authors[0]"
	[LICENSES]="project.license.text|project.license"
	[URL]="project.urls.homepage"
	[DOCUMENTATION]="project.urls.documentation|SPECIAL:extract_documentation_from_repo"
	[SOURCE]="project.urls.repository|project.urls.source"
)

declare -A RUST_FIELD_PATHS=(
	[TITLE]="package.name"
	[DESCRIPTION]="package.description"
	[VERSION]="package.version"
	[AUTHORS]="package.authors[0]"
	[VENDOR]="package.authors[0]"
	[LICENSES]="package.license"
	[URL]="package.homepage"
	[DOCUMENTATION]="package.documentation|SPECIAL:rust_extract_documentation"
	[SOURCE]="package.repository"
)

declare -A PHP_FIELD_PATHS=(
	[TITLE]="name"
	[DESCRIPTION]="description"
	[VERSION]="version"
	[AUTHORS]="authors[0].name"
	[VENDOR]="authors[0].name"
	[LICENSES]="license"
	[URL]="homepage"
	[DOCUMENTATION]="support.docs|SPECIAL:extract_documentation_from_repo"
	[SOURCE]="support.source"
)

declare -A GO_FIELD_PATHS=(
	[TITLE]="SPECIAL:go_extract_name"
	[DESCRIPTION]=""
	[VERSION]="SPECIAL:go_extract_version"
	[AUTHORS]=""
	[VENDOR]=""
	[LICENSES]=""
	[URL]="SPECIAL:go_extract_homepage"
	[DOCUMENTATION]="SPECIAL:go_extract_documentation"
	[SOURCE]="SPECIAL:go_extract_repository"
)

declare -A FIELD_PATH_MAPS=(
	[node]="NODE_FIELD_PATHS"
	[python]="PYTHON_FIELD_PATHS"
	[rust]="RUST_FIELD_PATHS"
	[php]="PHP_FIELD_PATHS"
	[go]="GO_FIELD_PATHS"
)

declare -A FIELD_TRANSFORMS=(
	[SOURCE]="transform_repository_url"
)

declare -A METADATA_EXTRACTOR_MAP=(
	[node]="extract_generic_metadata"
	[python]="extract_generic_metadata"
	[rust]="extract_generic_metadata"
	[php]="extract_generic_metadata"
	[go]="extract_generic_metadata"
)

# ==============================================================================
# SECTION 4: Project Detection & Validation (Lazy, Callable)
# ==============================================================================

declare -g PROJECT_TYPE_VALIDATED=false
declare -g PARSER_INITIALIZED=false

function detect_project_type() {
	debug "Detecting project type in $PROJECT_ROOT"

	for project_type in "${PROJECT_DETECTION_ORDER[@]}"; do
		local metadata_file="${PROJECT_METADATA_FILE[$project_type]}"
		local full_path="$PROJECT_ROOT/$metadata_file"

		if [[ -f "$full_path" ]]; then
			debug "Found $metadata_file -> $project_type"
			echo "$project_type"
			return 0
		fi
	done

	debug "No project metadata file found"
	return 1
}

function validate_project_type() {
	[[ "$PROJECT_TYPE_VALIDATED" == true ]] && return 0

	# Auto-detect if not set
	if [[ -z "$PROJECT_TYPE" ]]; then
		debug "PROJECT_TYPE not set, attempting auto-detection"

		if ! PROJECT_TYPE=$(detect_project_type); then
			cat >&2 <<EOF
Error: Could not detect project type

Searched for these files in $PROJECT_ROOT:
  - package.json (Node.js)
  - pyproject.toml (Python)
  - Cargo.toml (Rust)
  - composer.json (PHP)
  - go.mod (Go)

None were found. Please specify explicitly:
  PROJECT_TYPE=node $0 $COMMAND

Supported types: ${!PROJECT_PARSER_TYPE[@]}
EOF
			return 1
		fi

		debug "Auto-detected: $PROJECT_TYPE"
	fi

	# Validate it's a known type
	if [[ ! -v "PROJECT_PARSER_TYPE[$PROJECT_TYPE]" ]]; then
		cat >&2 <<EOF
Error: Unknown project type '$PROJECT_TYPE'

Supported types: ${!PROJECT_PARSER_TYPE[@]}

Usage:
  PROJECT_TYPE=<type> $0 $COMMAND
EOF
		return 1
	fi

	PROJECT_TYPE_VALIDATED=true
	debug "Project type validated: $PROJECT_TYPE"
	return 0
}

function initialize_parser() {
	[[ "$PARSER_INITIALIZED" == true ]] && return 0

	# Requires valid project type
	validate_project_type || return 1

	local parser_type="${PROJECT_PARSER_TYPE[$PROJECT_TYPE]}"
	local parser_collection="${PARSER_TYPE_MAP[$parser_type]}"

	# Detect available parser
	declare -n parsers_ref="$parser_collection"
	for parser in "${!parsers_ref[@]}"; do
		if command -v "$parser" >/dev/null 2>&1; then
			ACTIVE_PARSER="$parser"
			PARSER_FUNC="${parsers_ref[$parser]}"
			METADATA_FILE="${PROJECT_ROOT}/${PROJECT_METADATA_FILE[$PROJECT_TYPE]}"
			PARSER_INITIALIZED=true
			debug "Using $parser for $parser_type"
			debug "Metadata file: $METADATA_FILE"
			return 0
		fi
	done

	# No parser found
	cat >&2 <<EOF
Error: No $parser_type parser available

Tried: ${!parsers_ref[@]}

EOF

	if [[ "$parser_type" == "toml" ]]; then
		echo "To install: pip install yq  # Provides tomlq" >&2
	else
		echo "To install: Install jq or ensure node is in PATH" >&2
	fi

	return 1
}

# ==============================================================================
# SECTION 5: Core Functions
# ==============================================================================

declare -g METADATA_CACHE=""
declare -g METADATA_CACHE_LOADED=false

function load_metadata_cache() {
	[[ "$METADATA_CACHE_LOADED" == true ]] && return 0

	if [[ ! -f "$METADATA_FILE" ]]; then
		die "Metadata file not found: $METADATA_FILE"
	fi

	METADATA_CACHE=$(<"$METADATA_FILE")
	METADATA_CACHE_LOADED=true
	debug "Loaded metadata cache from $METADATA_FILE"
}

function parse_json_with_jq() {
	local source=$1 field=$2
	if [[ "$source" == "-" ]]; then
		jq -c ".${field} // \"\""
	else
		load_metadata_cache
		echo "$METADATA_CACHE" | jq -c ".${field} // \"\""
	fi
}

function parse_json_with_node() {
	local source=$1 field=$2
	if [[ "$source" == "-" ]]; then
		node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0, 'utf-8')).${field} || '')"
	else
		load_metadata_cache
		echo "$METADATA_CACHE" | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0, 'utf-8')).${field} || '')"
	fi
}

function parse_toml_with_tomlq() {
	local source=$1 field=$2
	if [[ "$source" == "-" ]]; then
		tomlq -c ".${field} // \"\""
	else
		load_metadata_cache
		echo "$METADATA_CACHE" | tomlq -c ".${field} // \"\""
	fi
}

function parse_file() {
	"$PARSER_FUNC" "$@"
}

function extract_documentation_from_repo() {
	local repo=$(extract_field "SOURCE")
	[[ -n "$repo" ]] && echo "${repo}/blob/main/README.md"
}

function rust_extract_documentation() {
	local name=$(extract_field "TITLE")
	[[ -n "$name" ]] && echo "https://docs.rs/${name}"
}

function go_extract_name() {
	local module=$(parse_file "$METADATA_FILE" "module")
	echo "${module##*/}"
}

function go_extract_version() {
	git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null || echo ""
}

function go_extract_homepage() {
	local module=$(parse_file "$METADATA_FILE" "module")
	[[ "$module" =~ ^github\.com/ ]] && echo "https://${module}"
}

function go_extract_repository() {
	go_extract_homepage
}

function go_extract_documentation() {
	local module=$(parse_file "$METADATA_FILE" "module")
	[[ "$module" =~ ^github\.com/ ]] && echo "https://pkg.go.dev/${module}"
}

function get_field_value() {
	local project_type=$1 field=$2
	local map_name="${FIELD_PATH_MAPS[$project_type]}"

	[[ -z "$map_name" ]] && return 1

	declare -n field_map="$map_name"
	local path_spec="${field_map[$field]}"

	[[ -z "$path_spec" ]] && return

	# Handle special handlers
	if [[ "$path_spec" =~ ^SPECIAL: ]]; then
		"${path_spec#SPECIAL:}"
		return
	fi

	# Try fallback chain
	IFS='|' read -ra paths <<<"$path_spec"
	for path in "${paths[@]}"; do
		local value
		if [[ "$path" =~ ^SPECIAL: ]]; then
			value=$("${path#SPECIAL:}")
		else
			value=$(parse_file "$METADATA_FILE" "$path")
		fi

		local cleaned=$(strip_json_quotes "$value")
		if [[ -n "$cleaned" && "$cleaned" != "null" ]]; then
			echo "$value"
			return
		fi
	done
}

function transform_noop() {
	strip_json_quotes "$1"
}

function transform_repository_url() {
	local value=$1

	[[ -z "$value" || "$value" == "null" || "$value" == '""' ]] && return

	[[ "$value" =~ ^\{ ]] && value=$(echo "$value" | parse_file "-" "url")

	value=$(strip_json_quotes "$value")
	value="${value#git+}"
	value="${value%.git}"
	echo "$value"
}

function extract_generic_metadata() {
	local field=$1
	local value=$(get_field_value "$PROJECT_TYPE" "$field")
	local transform_func="${FIELD_TRANSFORMS[$field]:-transform_noop}"
	"$transform_func" "$value"
}

function extract_field() {
	local field=$1
	local extractor_func="${METADATA_EXTRACTOR_MAP[$PROJECT_TYPE]}"
	"$extractor_func" "$field"
}

# ==============================================================================
# SECTION 6: Commands
# ==============================================================================

function get_labels() {
	# Requires project detection
	initialize_parser || return 1

	for field in "${OCI_LABELS[@]}"; do
		[[ "$field" == "CREATED" || "$field" == "REVISION" ]] && continue
		echo "${field}=$(extract_field "$field")"
	done

	echo "CREATED=$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
	echo "REVISION=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo '')"
}

function build() {
	# Requires project detection
	initialize_parser || return 1

	local container_name version
	container_name=$(extract_field "TITLE") || die "Could not extract TITLE"
	version=$(extract_field "VERSION") || die "Could not extract VERSION"

	local dockerfile="${PROJECT_ROOT}/Dockerfile"
	[[ -f "$dockerfile" ]] || die "Dockerfile not found: $dockerfile"

	echo "Building ${container_name}:${version}..."
	echo "Project:  $PROJECT_TYPE"
	echo "Parser:   $ACTIVE_PARSER"
	echo ""

	podman build --squash \
		--build-arg-file <(get_labels) \
		-t "${container_name}:${version}" \
		-t "${container_name}:latest" \
		-f "$dockerfile" \
		"$PROJECT_ROOT" || die "Build failed"

	echo ""
	echo "✅ Build complete!"
	echo "   ${container_name}:${version}"
	echo "   ${container_name}:latest"
}

function inspect() {
	# Requires project detection
	initialize_parser || return 1

	local container_name version
	container_name=$(extract_field "TITLE")
	version=$(extract_field "VERSION")

	echo "OCI Labels for ${container_name}:${version}:"
	echo ""

	podman inspect "${container_name}:${version}" 2>/dev/null |
		jq -r '.[0].Config.Labels | to_entries[] | select(.key | startswith("org.opencontainers.image")) | "\(.key)=\(.value)"' |
		sort || echo "Image not found. Run: $0 build"
}

function help() {
	# Does NOT require project detection
	local detected=""
	if detected=$(detect_project_type 2>/dev/null); then
		: # Success, keep value
	else
		detected="none"
	fi

	cat <<EOF
Usage: [PROJECT_TYPE=<type>] $0 <command>

Project Types (auto-detected if not specified):
    node      Node.js/npm (package.json)
    python    Python/pip (pyproject.toml)
    rust      Rust/cargo (Cargo.toml)
    php       PHP/composer (composer.json)
    go        Go modules (go.mod)

Commands:
    get_labels  Show OCI labels
    build       Build container
    inspect     Inspect built image
    help        Show this help (default)

Examples:
    $0                              # Show help
    $0 build                        # Auto-detect and build
    $0 get_labels                   # Auto-detect and show labels
    PROJECT_TYPE=python $0 build    # Explicit type
    DEBUG=true $0 build             # Debug mode

Current Environment:
    Project Root:  $PROJECT_ROOT
    Detected Type: $detected
    PROJECT_TYPE:  ${PROJECT_TYPE:-not set}

For more information, see the usage examples at the top of this script.
EOF
}

# ==============================================================================
# SECTION 7: Dispatcher
# ==============================================================================

# Validate command exists
if ! declare -f "$COMMAND" >/dev/null 2>&1; then
	cat >&2 <<EOF
Error: Unknown command '$COMMAND'

Available commands: get_labels, build, inspect, help
Run '$0 help' for more information
EOF
	exit 1
fi

# Execute command
"$COMMAND" "${@:2}" || {
	exit_code=$?
	echo "" >&2
	echo "Command '$COMMAND' failed with exit code $exit_code" >&2
	exit $exit_code
}
