#!/bin/sh
# T3-28 fixture cutter (frozen): prints one library's facts as JSON, in the shape readLibraryFacts returns
# ({ entry, abi, name, problems, packedRelocations, symbols, relocations, markers }), read with llvm-readelf, grep and
# jq only, never with the code under test (docs/specs/T3-28.md, "Test plan").
#
# Run: sh scripts/fixtures/tv/native/cut-library.sh <entry name in the APK, lib/<abi>/<name>.so> <path of the .so>
# symbols and relocations hold only names starting with the DISPATCHER or LOADER prefix.
set -eu
entry=$1
file=$2
abi=$(echo "$entry" | cut -d/ -f2)
name=$(echo "$entry" | cut -d/ -f3)
prefix='_ZN8facebook5react18jsinspector_modern14NetworkIOAgent(13handleRequestE|25handleLoadNetworkResourceE)'

# packedRelocations: a section of type ANDROID_REL, ANDROID_RELA or CREL.
if llvm-readelf -S -W "$file" | grep -qE ' (ANDROID_RELA?|CREL) '; then packed=true; else packed=false; fi

# Dynamic symbols: Num Value Size Type Bind Vis Ndx Name.
symbols=$(llvm-readelf --dyn-syms -W "$file" | awk -v re="^$prefix" '
  $8 ~ re { printf "{\"name\":\"%s\",\"defined\":%s,\"type\":\"%s\",\"bind\":\"%s\",\"visibility\":\"%s\"}\n", $8, ($7 == "UND" ? "false" : "true"), $4, $5, $6 }' | jq -s .)

# Relocations naming a symbol: the section from the "Relocation section '<name>'" line, the name from field 5.
relocations=$(llvm-readelf -r -W "$file" | awk -v re="^$prefix" '
  /^Relocation section / { section = $3; gsub("\047", "", section); next }
  $5 ~ re { printf "{\"section\":\"%s\",\"name\":\"%s\"}\n", section, $5 }' | jq -s .)

markers=$(for m in "React Native DevTools" "is not implemented by this host target delegate"; do
  if grep -q -a -F "$m" "$file"; then printf '%s\n' "$m"; fi
done | jq -R . | jq -s .)

jq -n --arg entry "$entry" --arg abi "$abi" --arg name "$name" --argjson packed "$packed" \
  --argjson symbols "$symbols" --argjson relocations "$relocations" --argjson markers "$markers" \
  '{ entry: $entry, abi: $abi, name: $name, problems: [], packedRelocations: $packed, symbols: $symbols, relocations: $relocations, markers: $markers }'
