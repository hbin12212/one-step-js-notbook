import { Client as OfficialClient } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionAPI as RecordMapClient } from "notion-client";
import { Section } from "types/content";
import { ContentPage } from "types/notion";
import { ExtendedRecordMap } from "notion-types";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const officalClient = new OfficialClient({
    auth: NOTION_API_KEY,
});
const recordMapClient = new RecordMapClient({});

// 노션(www.notion.so)이 비공식 API 요청을 User-Agent로 걸러서 403 Forbidden을 준다.
// notion-client 내부 HTTP 라이브러리(got)의 기본 UA가 여기에 차단되므로
// 브라우저 UA를 명시적으로 실어 보낸다.
// getPage에 넘긴 gotOptions는 하위 요청(loadPageChunk / syncRecordValues /
// queryCollection / getSignedFileUrls) 전부에 그대로 전달된다.
const NOTION_GOT_OPTIONS = {
    headers: {
        "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
};

const convertContentPage = (pageObject: PageObjectResponse) => {
    const { id, last_edited_time } = pageObject;
    const res: ContentPage = {
        id,
        last_edited_time,
        section: { index: 0, title: "" },
        chapter: { index: 0, title: "" },
    };

    Object.keys(pageObject.properties).forEach((propertyName) => {
        const property = pageObject.properties[propertyName];
        switch (propertyName) {
            case "section_title": {
                if (property.type === "select") {
                    res.section.title = property.select?.name || "";
                }
                break;
            }
            case "section_index": {
                if (property.type === "number") {
                    res.section.index = property.number as number;
                }
                break;
            }
            case "chapter_title": {
                if (property.type === "title") {
                    res.chapter.title = property.title.map((it) => it.plain_text).join(" ") as string;
                }
                break;
            }
            case "chapter_index": {
                if (property.type === "number") {
                    res.chapter.index = property.number as number;
                }
                break;
            }
        }
    });

    return res;
};

export const fetchAllPages = async () => {
    try {
        const queryData = await officalClient.databases.query({
            database_id: DATABASE_ID as string,
        });
        const contents = queryData.results.map((pageObject) => {
            return convertContentPage(pageObject as PageObjectResponse);
        });
        return contents;
    } catch (e) {
        console.error("FETCH ALL PAGES ERROR", e);
        throw new Error("FETCH ALL PAGES ERROR");
    }
};

const convertPagesToSections = (pages: ContentPage[]) => {
    const sections: Section[] = [];
    pages.map((page) => {
        let sectionIdx = sections.findIndex((section) => section.index === page.section.index);

        if (sectionIdx === -1) {
            sections.push({
                title: page.section.title || "",
                index: page.section.index,
                chapters: [],
            });
            sectionIdx = sections.length - 1;
        }

        sections[sectionIdx].chapters.push({
            id: page.id,
            last_edited_time: page.last_edited_time,
            title: page.chapter.title || "",
            index: page.chapter.index,
            section_title: page.section.title,
            section_index: page.section.index,
        });
    });

    return sections;
};

export const getSections = async () => {
    try {
        const pages = await fetchAllPages();
        if (!pages) {
            throw new Error("get sections error");
        }
        return convertPagesToSections(pages);
    } catch (e) {
        console.error("FETCH SECTION ERROR", e);
        throw new Error("FETCH SECTION ERROR");
    }
};

// 노션이 recordMap 응답을 { value: { value, role } } 로 한 겹 더 감싸도록 변경했다.
// react-notion-x 6.x 는 { value } 형태를 기대하므로 예전 구조로 되돌려준다.
const normalizeRecordMap = (recordMap: any) => {
    const tables = ["block", "collection", "collection_view", "notion_user", "space"];
    tables.forEach((table) => {
        const records = recordMap?.[table];
        if (!records) return;
        Object.keys(records).forEach((id) => {
            const entry = records[id];
            if (entry?.value?.value) {
                records[id] = {
                    ...entry,
                    value: entry.value.value,
                    role: entry.value.role ?? entry.role,
                };
            }
        });
    });
    return recordMap as ExtendedRecordMap;
};

export const fetchRecordMap = async (pageID: string) => {
    try {
        const recordMap: ExtendedRecordMap = normalizeRecordMap(
            await recordMapClient.getPage(pageID, { gotOptions: NOTION_GOT_OPTIONS })
        );
        return recordMap;
    } catch (e) {
        console.log(e);
        throw new Error("FETCH RECORDMAP ERROR");
    }
};
