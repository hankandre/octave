# T3-19 test fixture support (frozen): how release-mapping.txt was cut. Run:
#   awk -v spec="$(cat mapping-spec.txt)" -f cut-mapping.awk apps/tv/android/app/build/outputs/mapping/release/mapping.txt
# then the provenance comment was inserted after the 7-line R8 header.
# Cut a mapping excerpt in file order. -v spec="dex=mode;..." where mode is "all", "class", or a member-name regex.
BEGIN { n = split(spec, parts, ";"); for (i = 1; i <= n; i++) { split(parts[i], kv, "="); want[kv[1]] = kv[2] } }
NR <= 7 { print; next }
/^[^ #]/ { dex = $NF; sub(/:$/, "", dex); mode = (dex in want) ? want[dex] : ""; keep = 0; if (mode != "") print; next }
mode == "" { next }
/^# / { if (mode != "class") print; next }
/^    [^ ]/ { keep = (mode == "all") || (mode != "class" && $NF ~ ("^(" mode ")$")); if (keep) print; next }
/^      #/ { if (keep) print; next }
