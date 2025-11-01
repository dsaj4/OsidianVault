module.exports = {
  // Renamed to 'start' for clarity and convention
  start: async (params) => {
    const { app } = params;
    const today = moment().format("YYYY-MM-DD");
    const files = app.vault.getMarkdownFiles();
    const updatedFiles = [];

    await Promise.all(
      files.map(async (file) => {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) {
          return;
        }

        const tags = frontmatter.tags;
        const hasTaskTag = Array.isArray(tags)
          ? tags.includes("task")
          : tags === "task";

        const statusIsNotDone = frontmatter.status && frontmatter.status !== "done";

        if (hasTaskTag && statusIsNotDone) {
          try {
            let content = await app.vault.read(file);
            const scheduledRegex = /^(scheduled:\s*).*/m;

            if (scheduledRegex.test(content)) {
              content = content.replace(scheduledRegex, `$1${today}`);
              await app.vault.modify(file, content);
              updatedFiles.push(file.path);
            }
          } catch (err) {
            console.error(`QuickAdd Script Error: Failed to process file ${file.path}`, err);
          }
        }
      })
    );

    if (updatedFiles.length > 0) {
      const fileList = updatedFiles.join("\n- ");
      new Notice(
        `Updated 'scheduled' date to ${today} for ${updatedFiles.length} file(s):\n- ${fileList}`
      );
    }
  },
};
