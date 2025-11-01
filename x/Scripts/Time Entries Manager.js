/**
 * QuickAdd Script: Time Entries Manager
 * 用于查看和修改 Obsidian 笔记中的 timeEntries
 */

module.exports = async (params) => {
    const { quickAddApi: QuickAdd, app } = params;

    // 默认任务文件夹路径
    const DEFAULT_TASKS_FOLDER = "Calendar/Tasks";

    // 获取所有笔记文件，并过滤出 Calendar/Tasks 目录下的文件
    const allFiles = app.vault.getMarkdownFiles();
    const files = allFiles.filter(file =>
        file.path.startsWith(DEFAULT_TASKS_FOLDER + "/") ||
        file.path === DEFAULT_TASKS_FOLDER + ".md"
    );

    // 检查是否有符合条件的文件
    if (files.length === 0) {
        new Notice(`未在 ${DEFAULT_TASKS_FOLDER} 目录下找到任务文件`);
        return;
    }

    // 让用户选择笔记，显示相对于 Calendar/Tasks 的路径
    const fileChoices = files.map(f => {
        // 移除 Calendar/Tasks/ 前缀，使显示更简洁
        const displayPath = f.path.replace(DEFAULT_TASKS_FOLDER + "/", "");
        return displayPath;
    });

    const selectedFileName = await QuickAdd.suggester(
        fileChoices,
        files.map(f => f.path)
    );

    if (!selectedFileName) {
        new Notice("未选择笔记");
        return;
    }

    const file = app.vault.getAbstractFileByPath(selectedFileName);
    if (!file) {
        new Notice("笔记不存在");
        return;
    }

    // 读取文件内容
    const content = await app.vault.read(file);

    // 解析 frontmatter
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        new Notice("未找到 frontmatter");
        return;
    }

    const frontmatterText = match[1];
    let timeEntries = [];

    // 解析 timeEntries
    try {
        // 提取 timeEntries 部分
        const timeEntriesMatch = frontmatterText.match(/timeEntries:\s*([\s\S]*?)(?=\n\w|$)/);
        if (timeEntriesMatch) {
            timeEntries = parseTimeEntries(timeEntriesMatch[0]);
        }
    } catch (e) {
        new Notice("解析 timeEntries 失败: " + e.message);
        return;
    }

    // 主菜单
    while (true) {
        const action = await QuickAdd.suggester(
            [
                "📋 查看所有时间记录",
                "➕ 添加新记录",
                "✏️ 编辑记录",
                "🗑️ 删除记录",
                "📊 查看统计信息",
                "❌ 退出"
            ],
            ["view", "add", "edit", "delete", "stats", "exit"]
        );

        if (!action || action === "exit") {
            break;
        }

        switch (action) {
            case "view":
                await viewTimeEntries(QuickAdd, timeEntries);
                break;
            case "add":
                const newEntry = await addTimeEntry(QuickAdd);
                if (newEntry) {
                    timeEntries.push(newEntry);
                    await saveTimeEntries(app, file, content, timeEntries);
                    new Notice("✅ 添加成功");
                }
                break;
            case "edit":
                await editTimeEntry(QuickAdd, app, file, content, timeEntries);
                break;
            case "delete":
                await deleteTimeEntry(QuickAdd, app, file, content, timeEntries);
                break;
            case "stats":
                await showStats(QuickAdd, timeEntries);
                break;
        }
    }
};

/**
 * 解析 timeEntries YAML
 */
function parseTimeEntries(yamlText) {
    const entries = [];
    const lines = yamlText.split('\n');
    let currentEntry = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- startTime:')) {
            if (currentEntry) {
                entries.push(currentEntry);
            }
            currentEntry = {
                startTime: trimmed.replace('- startTime:', '').trim()
            };
        } else if (trimmed.startsWith('startTime:') && currentEntry) {
            currentEntry.startTime = trimmed.replace('startTime:', '').trim();
        } else if (trimmed.startsWith('endTime:') && currentEntry) {
            currentEntry.endTime = trimmed.replace('endTime:', '').trim();
        } else if (trimmed.startsWith('description:') && currentEntry) {
            currentEntry.description = trimmed.replace('description:', '').trim();
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    return entries;
}

/**
 * 查看所有时间记录
 */
async function viewTimeEntries(QuickAdd, timeEntries) {
    if (timeEntries.length === 0) {
        new Notice("暂无时间记录");
        return;
    }

    const display = timeEntries.map((entry, index) => {
        const start = new Date(entry.startTime);
        const end = entry.endTime ? new Date(entry.endTime) : null;
        const duration = end ? formatDuration(end - start) : "进行中";

        return `${index + 1}. ${entry.description || "Work session"}\n   开始: ${formatDateTime(start)}\n   ${end ? `结束: ${formatDateTime(end)}` : "状态: 进行中"}\n   时长: ${duration}`;
    }).join('\n\n');

    await QuickAdd.suggester(
        [display],
        ["ok"]
    );
}

/**
 * 添加新的时间记录
 */
async function addTimeEntry(QuickAdd) {
    const description = await QuickAdd.inputPrompt("描述 (可选，留空使用默认):", "Work session");
    if (description === undefined) return null;

    const startTimeStr = await QuickAdd.inputPrompt(
        "开始时间 (ISO格式或留空使用当前时间):",
        new Date().toISOString()
    );
    if (!startTimeStr) return null;

    const hasEndTime = await QuickAdd.yesNoPrompt("是否设置结束时间?");
    let endTime = null;

    if (hasEndTime) {
        endTime = await QuickAdd.inputPrompt(
            "结束时间 (ISO格式或留空使用当前时间):",
            new Date().toISOString()
        );
    }

    const entry = {
        startTime: startTimeStr,
        description: description || "Work session"
    };

    if (endTime) {
        entry.endTime = endTime;
    }

    return entry;
}

/**
 * 编辑时间记录
 */
async function editTimeEntry(QuickAdd, app, file, content, timeEntries) {
    if (timeEntries.length === 0) {
        new Notice("暂无时间记录");
        return;
    }

    const choices = timeEntries.map((entry, index) => {
        const start = new Date(entry.startTime);
        const end = entry.endTime ? new Date(entry.endTime) : null;
        return `${index + 1}. ${entry.description} (${formatDateTime(start)} - ${end ? formatDateTime(end) : "进行中"})`;
    });

    const selectedIndex = await QuickAdd.suggester(choices, timeEntries.map((_, i) => i));
    if (selectedIndex === undefined) return;

    const entry = timeEntries[selectedIndex];

    // 显示更详细的编辑选项
    const fieldOptions = ["描述", "开始时间", "结束时间"];
    const fieldValues = ["description", "startTime", "endTime"];

    // 如果有结束时间，添加删除选项
    if (entry.endTime) {
        fieldOptions.push("删除结束时间");
        fieldValues.push("removeEndTime");
    } else {
        // 如果没有结束时间，添加设置选项
        fieldOptions.push("设置结束时间");
        fieldValues.push("setEndTime");
    }

    const field = await QuickAdd.suggester(fieldOptions, fieldValues);

    if (!field) return;

    // 处理删除结束时间
    if (field === "removeEndTime") {
        delete entry.endTime;
        await saveTimeEntries(app, file, content, timeEntries);
        new Notice("✅ 已删除结束时间");
        return;
    }

    // 处理设置结束时间
    if (field === "setEndTime") {
        const endTime = await QuickAdd.inputPrompt(
            "结束时间 (ISO格式或留空使用当前时间):",
            new Date().toISOString()
        );
        if (endTime) {
            entry.endTime = endTime;
            await saveTimeEntries(app, file, content, timeEntries);
            new Notice("✅ 已设置结束时间");
        }
        return;
    }

    // 编辑描述
    if (field === "description") {
        const currentValue = entry.description || "Work session";
        const newValue = await QuickAdd.inputPrompt(
            `描述\n当前值: ${currentValue}`,
            currentValue
        );

        if (newValue !== null && newValue !== undefined && newValue !== currentValue) {
            entry.description = newValue;
            await saveTimeEntries(app, file, content, timeEntries);
            new Notice("✅ 更新成功");
        }
        return;
    }

    // 编辑时间字段（开始时间或结束时间）
    const currentValue = entry[field];
    if (!currentValue) {
        new Notice("当前字段没有值");
        return;
    }

    const currentDate = new Date(currentValue);
    const readableTime = formatDateTime(currentDate);

    // 提供多种编辑方式
    const editMethod = await QuickAdd.suggester(
        [
            "✏️ 直接编辑 ISO 格式",
            "⏰ 设置为当前时间",
            "➕ 增加 1 小时",
            "➕➕ 增加 2 小时",
            "➕➕➕ 增加 3 小时",
            "➖ 减少 1 小时",
            "➖➖ 减少 2 小时",
            "➖➖➖ 减少 3 小时",
            "🕐 自定义增减小时数"
        ],
        ["edit", "now", "+1h", "+2h", "+3h", "-1h", "-2h", "-3h", "custom"]
    );

    if (!editMethod) return;

    let newValue;

    switch (editMethod) {
        case "edit":
            newValue = await QuickAdd.inputPrompt(
                `编辑 ${field === "startTime" ? "开始时间" : "结束时间"}\n当前值: ${readableTime}\nISO格式: ${currentValue}`,
                currentValue
            );
            break;

        case "now":
            newValue = new Date().toISOString();
            new Notice(`已设置为当前时间: ${formatDateTime(new Date(newValue))}`);
            break;

        case "+1h":
            newValue = adjustTimeByHours(currentValue, 1);
            new Notice(`已增加 1 小时`);
            break;

        case "+2h":
            newValue = adjustTimeByHours(currentValue, 2);
            new Notice(`已增加 2 小时`);
            break;

        case "+3h":
            newValue = adjustTimeByHours(currentValue, 3);
            new Notice(`已增加 3 小时`);
            break;

        case "-1h":
            newValue = adjustTimeByHours(currentValue, -1);
            new Notice(`已减少 1 小时`);
            break;

        case "-2h":
            newValue = adjustTimeByHours(currentValue, -2);
            new Notice(`已减少 2 小时`);
            break;

        case "-3h":
            newValue = adjustTimeByHours(currentValue, -3);
            new Notice(`已减少 3 小时`);
            break;

        case "custom":
            const hoursStr = await QuickAdd.inputPrompt(
                `输入小时数（正数增加，负数减少）\n当前时间: ${readableTime}`,
                "1"
            );
            if (hoursStr !== null && hoursStr !== undefined) {
                const hours = parseFloat(hoursStr);
                if (!isNaN(hours)) {
                    newValue = adjustTimeByHours(currentValue, hours);
                    new Notice(`已${hours > 0 ? '增加' : '减少'} ${Math.abs(hours)} 小时`);
                } else {
                    new Notice("❌ 输入的不是有效数字");
                    return;
                }
            }
            break;
    }

    if (newValue !== null && newValue !== undefined && newValue !== currentValue) {
        entry[field] = newValue;
        await saveTimeEntries(app, file, content, timeEntries);
        new Notice("✅ 更新成功");
    }
}

/**
 * 调整时间（增加或减少指定小时数）
 */
function adjustTimeByHours(isoString, hours) {
    const date = new Date(isoString);
    date.setHours(date.getHours() + hours);
    return date.toISOString();
}

/**
 * 删除时间记录
 */
async function deleteTimeEntry(QuickAdd, app, file, content, timeEntries) {
    if (timeEntries.length === 0) {
        new Notice("暂无时间记录");
        return;
    }

    const choices = timeEntries.map((entry, index) => {
        const start = new Date(entry.startTime);
        const end = entry.endTime ? new Date(entry.endTime) : null;
        return `${index + 1}. ${entry.description} (${formatDateTime(start)} - ${end ? formatDateTime(end) : "进行中"})`;
    });

    const selectedIndex = await QuickAdd.suggester(choices, timeEntries.map((_, i) => i));
    if (selectedIndex === undefined) return;

    const confirm = await QuickAdd.yesNoPrompt("确认删除这条记录?");
    if (confirm) {
        timeEntries.splice(selectedIndex, 1);
        await saveTimeEntries(app, file, content, timeEntries);
        new Notice("✅ 删除成功");
    }
}

/**
 * 显示统计信息
 */
async function showStats(QuickAdd, timeEntries) {
    if (timeEntries.length === 0) {
        new Notice("暂无时间记录");
        return;
    }

    let totalDuration = 0;
    let completedCount = 0;
    let ongoingCount = 0;

    timeEntries.forEach(entry => {
        if (entry.endTime) {
            const start = new Date(entry.startTime);
            const end = new Date(entry.endTime);
            totalDuration += (end - start);
            completedCount++;
        } else {
            ongoingCount++;
        }
    });

    const stats = `📊 统计信息\n\n` +
        `总记录数: ${timeEntries.length}\n` +
        `已完成: ${completedCount}\n` +
        `进行中: ${ongoingCount}\n` +
        `总时长: ${formatDuration(totalDuration)}\n` +
        `平均时长: ${completedCount > 0 ? formatDuration(totalDuration / completedCount) : "N/A"}`;

    await QuickAdd.suggester([stats], ["ok"]);
}

/**
 * 保存 timeEntries 到文件
 */
async function saveTimeEntries(app, file, originalContent, timeEntries) {
    // 生成新的 timeEntries YAML
    let timeEntriesYaml = "timeEntries:";

    if (timeEntries.length === 0) {
        timeEntriesYaml = "timeEntries: []";
    } else {
        timeEntriesYaml += "\n" + timeEntries.map(entry => {
            let yaml = `  - startTime: ${entry.startTime}\n`;
            yaml += `    description: ${entry.description || "Work session"}`;
            if (entry.endTime) {
                yaml += `\n    endTime: ${entry.endTime}`;
            }
            return yaml;
        }).join('\n');
    }

    // 替换原有的 timeEntries
    const frontmatterRegex = /^(---\n)([\s\S]*?)(\n---)/;
    const newContent = originalContent.replace(frontmatterRegex, (match, start, fm, end) => {
        // 移除旧的 timeEntries
        const cleaned = fm.replace(/timeEntries:[\s\S]*?(?=\n\w|\n---)/g, '').trim();
        // 添加新的 timeEntries
        return `${start}${cleaned}\n${timeEntriesYaml}${end}`;
    });

    await app.vault.modify(file, newContent);
}

/**
 * 格式化日期时间
 */
function formatDateTime(date) {
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * 格式化时长
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
    } else if (hours > 0) {
        return `${hours}小时 ${minutes % 60}分钟`;
    } else if (minutes > 0) {
        return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}
