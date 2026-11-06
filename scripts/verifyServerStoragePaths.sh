#!/bin/bash
# scripts/verifyServerStoragePaths.sh
# Diagnostic script to verify storage paths, permissions, and disk mounts on production

echo "================================================================="
echo "  PrintCart24 Production Storage Diagnostics"
echo "================================================================="

echo -e "\n[1] Checking /tmp/printcart24-documents (Current RAM/tmpfs Location):"
if [ -d "/tmp/printcart24-documents" ]; then
    ls -ld /tmp/printcart24-documents
    echo "Total Size:"
    du -sh /tmp/printcart24-documents
    echo "Folder contents:"
    ls -lh /tmp/printcart24-documents
else
    echo "Directory /tmp/printcart24-documents does not exist."
fi

echo -e "\n[2] Checking /tmp/printcart24-convert-* folders:"
CONVERT_COUNT=$(ls -d /tmp/printcart24-convert-* 2>/dev/null | wc -l)
echo "Found $CONVERT_COUNT conversion directories."
if [ "$CONVERT_COUNT" -gt 0 ]; then
    du -ch /tmp/printcart24-convert-* 2>/dev/null | tail -1
fi

echo -e "\n[3] Checking /var/tmp Filesystem & Disk Mount (New Target Location):"
df -h /var/tmp
df -T /var/tmp

echo -e "\n[4] Testing Directory Creation & Write Permissions on /var/tmp/printcart24-documents:"
mkdir -p /var/tmp/printcart24-documents
if [ $? -eq 0 ]; then
    echo "✅ Successfully created/verified directory: /var/tmp/printcart24-documents"
    ls -ld /var/tmp/printcart24-documents

    TEST_FILE="/var/tmp/printcart24-documents/verify_test_$(date +%s).txt"
    echo "PrintCart24 Storage Write Test" > "$TEST_FILE"
    if [ -f "$TEST_FILE" ]; then
        echo "✅ Successfully wrote test file:"
        ls -l "$TEST_FILE"
        rm -f "$TEST_FILE"
        echo "✅ Successfully deleted test file."
    else
        echo "❌ Failed to write test file to /var/tmp/printcart24-documents."
    fi
else
    echo "❌ Failed to create /var/tmp/printcart24-documents."
fi

echo -e "\n================================================================="
echo "  Diagnostics Completed"
echo "================================================================="
