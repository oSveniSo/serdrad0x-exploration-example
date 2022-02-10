const database = require('../../database');
const config = require('../../config').getConfig();
const { error } = require("../../error");
const { Status, checkColumn, getQuery } = require("../helpers");
const crypto = require('crypto');
const { filterQueryParams } = require("../helpers");
const { checkParams } = require("../helpers");

const db = config.DB_DATABASE;
const roomSalt = crypto.randomBytes(32).toString('hex');
const groupSalt = crypto.randomBytes(32).toString('hex');

async function getExploration(qry) {
    return await getQuery(
        qry,
        "http://127.0.0.1:3000/api/exploration",
        true,
        {
            required: [],
            optional: [
                "name",           // Eigene-Params brauchen ein checkColumn
                "mode",
                "room",
                //"visible",     // Benötigt entsprechende Berechtigung. Entweder Admin oder Ersteller der Exploration. Noch nicht implementiert!
                "id",                   // Standard-Params werden automatisch geprüft
                "limit",
                "offset",
                "order",
                "sort"
            ]
        },
        {},
        [
            checkColumn(qry.name, undefined, Status.OPTIONAL, "user", "name", "name", undefined),
            checkColumn(qry.mode, ["ffa", "group"], Status.OPTIONAL, "exploration", "mode", "mode", undefined),
            function () { // Let you search by room but will not work for router.get('/:id', asyncH... because here room is required and not optional
                if ("room" in qry) {
                    const room = filterQueryParams(qry.room);

                    let sql = `MD5(concat(${db}.exploration.roomCode, COALESCE(${db}.exploration.entryCode, -1), '${roomSalt}')) = '${room}'`;
                    let param = "room=" + room;
                    let err = [];

                    return [sql, param, err];
                }
                return ["1", "", []];
            }()
            //checkColumn(qry.room, undefined, Status.OPTIONAL, "exploration", "roomCode", "room", undefined)
            //checkColumn(qry.visible, ["ffa", "group"], Status.OPTIONAL, "exploration", "mode", "mode", undefined)
        ],
        async function (sqlWhere, sqlOrder, sqlSort, sqlLimit, sqlOffset) {
            const connection = await database.getConnection();
            let sql = `SELECT COUNT(*) AS total 
                       FROM exploration
                       WHERE ${db}.exploration.deleted IS NULL AND ${db}.exploration.deleted_from IS NULL AND ${db}.exploration.visible = 'public' AND ${sqlWhere.join(" AND ")}`;

            let total = (await connection.query(sql))[0].total;

            /*
            sql = `SELECT ${db}.exploration.id, ${db}.exploration.name, ${db}.exploration.description, ${db}.exploration.image, ${db}.exploration.visible, ${db}.exploration.mode, CASE WHEN ${db}.exploration.code IS NULL THEN 0 ELSE 1 END AS code
                   FROM ${db}.exploration
                   WHERE ${db}.exploration.deleted IS NULL AND ${db}.exploration.deleted_from IS NULL AND ${db}.exploration.visible = 'public' AND ${sqlWhere.join(" AND ")}
                   ORDER BY ${sqlOrder} ${sqlSort} LIMIT ${sqlLimit} OFFSET ${sqlOffset};`;
            */

            sql = `
                SELECT 
                    ${db}.exploration.id, 
                    ${db}.exploration.name, 
                    ${db}.exploration.description, 
                    ${db}.exploration.image, 
                    ${db}.exploration.visible, 
                    ${db}.exploration.mode,
                    ${db}.exploration.roomCode,
                    CASE
                        WHEN ${db}.exploration.entryCode IS NOT NULL
                        THEN -1
                        END AS entryCode,
                    ${db}.mode_group.name AS mode_name,
                    ${db}.mode_group.description AS mode_description,
                    ${db}.mode_group.image AS mode_image,
                    CASE
                        WHEN ${db}.mode_group.entryCode IS NOT NULL
                        THEN -1
                        END AS mode_entryCode,
                    ${db}.mode_group.groupCode AS mode_groupCode,
                    COALESCE(${db}.mode_group.participants, ${db}.mode_ffa.participants) AS mode_participants
                    FROM 
                        ${db}.exploration
                    LEFT OUTER JOIN ${db}.mode_ffa ON 
                        ${db}.exploration.id = ${db}.mode_ffa.id
                    LEFT OUTER JOIN ${db}.mode_group ON 
                        ${db}.exploration.id = ${db}.mode_group.exploration_id
                    WHERE 
                        ${db}.exploration.deleted IS NULL AND 
                        ${db}.exploration.deleted_from IS NULL AND 
                        ${db}.exploration.visible = 'public' AND 
                        ${sqlWhere.join(" AND ")}
                    ORDER BY 
                        ${sqlOrder} ${sqlSort} 
                    LIMIT 
                        ${sqlLimit} 
                    OFFSET 
                        ${sqlOffset};
            `;
            let data = await connection.query(sql);
            connection.release();

            let result = [];
            let activeId = -1;
            for (let i = 0; i < data.length; i++) {
                let element = data[i];

                if (activeId === -1 || activeId !== element.id) {
                    result.push({
                        id: element.id,
                        name: element.name,
                        description: element.description,
                        image: element.image,
                        visible: element.visible,
                        mode: element.mode,
                        entryCode: element.entryCode === -1,
                        roomCode: element.roomCode,
                        mode_data: []
                    });
                    if (element.mode === "ffa") {
                        result[result.length - 1].mode_data.push({
                            participants: element.mode_participants
                        })
                    } else if (element.mode === "group") {
                        result[result.length - 1].mode_data.push({
                            name: element.mode_name,
                            description: element.mode_description,
                            image: element.mode_image,
                            entryCode: element.mode_entryCode === -1,
                            groupCode: element.mode_groupCode,
                            participants: element.mode_participants
                        });
                        activeId = element.id;
                    } else {
                        error("getExploration - Unknown group found: ", element.mode);
                    }
                } else if (activeId === element.id) {
                    result[result.length - 1].mode_data.push({
                        name: element.mode_name,
                        description: element.mode_description,
                        image: element.mode_image,
                        entryCode: element.mode_entryCode === -1,
                        groupCode: element.mode_groupCode,
                        participants: element.mode_participants
                    });
                }
            }

            return [total, result];
        },
        getExploration.name);
}

async function getAuthRoom(qry) {
    let element = {
        params: {},
        total: 0,
        urls: {
            next: "",
            prev: "",
            first: "",
            last: ""
        },
        data: []
    };

    for (const [key, value] of Object.entries(qry)) {
        element.params[key] = decodeURIComponent(value);
    }

    const errors = [];

    const paramsAllowed = {
        required: [
            "room"
        ],
        optional: [
            "entry"
        ]
    }

    const resultParams = checkParams(qry, paramsAllowed);
    errors.push(...resultParams);

    if (!/[0-9a-z]{6}/.test(qry.room)) {
        errors.push(error("getAuthRoom - roomCode does not fit requirements: ", qry.room));
    } else {
        const connection = await database.getConnection();

        // COALESCE => Select first NOT NULL element
        // CASE => Condition
        let sql = `
            SELECT
                MD5(concat(${db}.exploration.roomCode, COALESCE(${db}.exploration.entryCode, -1), ?)) AS hashedRoomCode,
                CASE
                    WHEN ${db}.exploration.entryCode IS NOT NULL
                    THEN -1
                    END AS entryCode
            FROM
                exploration
            WHERE 
                roomCode = ?;
        `;

        let data = await connection.query(sql, [
            roomSalt,
            parseInt(qry.room)
        ]);

        if (data.length === 1) {
            if ("entry" in qry && qry.entry !== "") { // entry is set and not empty
                if (data[0].entryCode === null) { // entryCode in DB is not set
                    errors.push(error("getAuthRoom - entryCode in url query param set but not needed: ", qry.entry));
                } else if (!/[0-9a-z]{6}/.test(qry.entry)) { // entry fits prerequisites
                    errors.push(error("getAuthRoom - entryCode does not fit requirements: ", qry.entry));
                } else if (data[0].entryCode !== qry.entry) { // entryCode from DB and url are not the same
                    errors.push(error("getAuthRoom - Wrong entryCode in url query param entered: ", qry.entry));
                } else { // no errors
                    element.total = 1;
                    element.data.push({
                        hashedRoomCode: data[0].hashedRoomCode,
                    });
                }
            } else if (data[0].entryCode !== null) {
                errors.push(error("getAuthRoom - entryCode in url query param not set but needed!"));
            } else {
                element.total = 1;
                element.data.push({
                    hashedRoomCode: data[0].hashedRoomCode
                });
            }
        } else { // 0 or > 1
            errors.push(error("getAuthRoom - Amount of found elements is not 1 for roomCode: ", qry.room));
        }
    }
    return element;
}

async function getRoom(qry) {
    let element = {
        params: {},
        total: 0,
        urls: {
            next: "",
            prev: "",
            first: "",
            last: ""
        },
        data: []
    };

    for (const [key, value] of Object.entries(qry)) {
        element.params[key] = decodeURIComponent(value);
    }

    const errors = [];

    const paramsAllowed = {
        required: [
            "room"
        ],
        optional: []
    }

    const resultParams = checkParams(qry, paramsAllowed);
    errors.push(...resultParams);

    if (errors.length === 0) {
        const connection = await database.getConnection();

        let sql = `
            SELECT 
                ${db}.exploration.id, 
                ${db}.exploration.name, 
                ${db}.exploration.description, 
                ${db}.exploration.image, 
                ${db}.exploration.visible, 
                ${db}.exploration.mode,
                ${db}.exploration.roomCode,
                CASE
                    WHEN ${db}.exploration.entryCode IS NOT NULL
                    THEN -1
                    END AS entryCode,
                ${db}.mode_group.name AS mode_name,
                ${db}.mode_group.description AS mode_description,
                ${db}.mode_group.image AS mode_image,
                CASE
                    WHEN ${db}.mode_group.entryCode IS NOT NULL
                    THEN -1
                    END AS mode_entryCode,
                ${db}.mode_group.groupCode AS mode_groupCode,
                COALESCE(${db}.mode_group.participants, ${db}.mode_ffa.participants) AS mode_participants
            FROM 
                ${db}.exploration
            LEFT OUTER JOIN ${db}.mode_ffa ON 
                ${db}.exploration.id = ${db}.mode_ffa.id
            LEFT OUTER JOIN ${db}.mode_group ON 
                ${db}.exploration.id = ${db}.mode_group.exploration_id
            WHERE 
                ${db}.exploration.deleted IS NULL AND 
                ${db}.exploration.deleted_from IS NULL AND 
                MD5(concat(${db}.exploration.roomCode, COALESCE(${db}.exploration.entryCode, -1), ?)) = ?
        `;

        let data = await connection.query(sql, [
            roomSalt,
            qry.room
        ]);
        connection.release();

        let result = [];
        let activeId = -1;
        for (let i = 0; i < data.length; i++) {
            let element = data[i];

            if (activeId === -1 || activeId !== element.id) {
                result.push({
                    id: element.id,
                    name: element.name,
                    description: element.description,
                    image: element.image,
                    visible: element.visible,
                    mode: element.mode,
                    entryCode: element.entryCode === -1,
                    roomCode: element.roomCode,
                    mode_data: []
                });
                if (element.mode === "ffa") {
                    result[result.length - 1].mode_data.push({
                        participants: element.mode_participants
                    });
                } else if (element.mode === "group") {
                    result[result.length - 1].mode_data.push({
                        name: element.mode_name,
                        description: element.mode_description,
                        image: element.mode_image,
                        entryCode: element.mode_entryCode === -1,
                        groupCode: element.mode_groupCode, // !!!!!!!!!!!!!!!!!!!!!!
                        participants: element.mode_participants
                    });
                    activeId = element.id;
                } else {
                    error("getExploration - Unknown group found: ", element.mode);
                }
            } else if (activeId === element.id) {
                result[result.length - 1].mode_data.push({
                    name: element.mode_name,
                    description: element.mode_description,
                    image: element.mode_image,
                    entryCode: element.mode_entryCode === -1,
                    groupCode: element.mode_groupCode,
                    participants: element.mode_participants
                });
            }
        }

        if (result.length === 1) {
            element.total = 1;
            element.data = result;
        } else {
            errors.push(error("getRoom - Amount of found elements is not 1 for roomCode: ", qry.room));
        }
    }

    return element;
}

async function getAuthGroup(qry) {
    let element = {
        params: {},
        total: 0,
        urls: {
            next: "",
            prev: "",
            first: "",
            last: ""
        },
        data: []
    };

    for (const [key, value] of Object.entries(qry)) {
        element.params[key] = decodeURIComponent(value);
    }

    const errors = [];

    const paramsAllowed = {
        required: [
            "group",
            "room"
        ],
        optional: [
            "entry"
        ]
    }

    const resultParams = checkParams(qry, paramsAllowed);
    errors.push(...resultParams);

    if (!/[0-9a-z]{6}/.test(qry["room"])) {
        errors.push(error("getAuthGroup - roomCode does not fit requirements: ", qry["room"]));
    } else if (!/[0-9a-z]{6}/.test(qry["group"])) {
        errors.push(error("getAuthGroup - groupCode does not fit requirements: ", qry["group"]));
    } else {
        const connection = await database.getConnection();

        // COALESCE => Select first NOT NULL element
        // CASE => Condition
        let sql = `
            SELECT
                MD5(concat(${db}.mode_group.groupCode, COALESCE(${db}.mode_group.entryCode, -1), ?)) AS hashedGroupCode,
                CASE
                    WHEN ${db}.mode_group.entryCode IS NOT NULL
                    THEN -1
                    END AS entryCode
            FROM
                ${db}.mode_group,
                ${db}.exploration
            WHERE 
                ${db}.mode_group.groupCode = ? AND
                MD5(concat(${db}.mode_group.roomCode, COALESCE(${db}.exploration.entryCode, -1), ?)) = ?;
        `;

        let data = await connection.query(sql, [
            groupSalt,
            parseInt(qry["group"]),
            roomSalt,
            qry["room"]
        ]);

        if (data.length === 1) {
            if ("entry" in qry && qry.entry !== "") { // entry is set and not empty
                if (data[0].entryCode === null) { // entryCode in DB is not set
                    errors.push(error("getAuthGroup - entryCode in url query param set but not needed: ", qry.entry));
                } else if (!/[0-9a-z]{6}/.test(qry.entry)) { // entry fits prerequisites
                    errors.push(error("getAuthGroup - entryCode does not fit requirements: ", qry.entry));
                } else if (data[0].entryCode !== qry.entry) { // entryCode from DB and url are not the same
                    errors.push(error("getAuthGroup - Wrong entryCode in url query param entered: ", qry.entry));
                } else { // no errors
                    element.total = 1;
                    element.data.push({
                        hashedRoomCode: data[0].hashedRoomCode,
                    });
                }
            } else if (data[0].entryCode !== null) {
                errors.push(error("getAuthGroup - entryCode in url query param not set but needed!"));
            } else {
                element.total = 1;
                element.data.push({
                    hashedGroupCode: data[0].hashedGroupCode
                });
            }
        } else { // 0 or > 1
            errors.push(error("getAuthGroup - Amount of found elements is not 1 for groupCode: ", qry.room));
        }
    }
    return element;
}

async function getAuth(qry) {
    if ("group" in qry && qry["group"] !== "" && "room" in qry && qry.room !== "") {
        return getAuthGroup(qry);
    } else if ("group" in qry) {
        return getAuthRoom(qry);
    }
    return {
        params: {},
        total: 0,
        urls: {
            next: "",
            prev: "",
            first: "",
            last: ""
        },
        data: []
    };
}

module.exports.getExploration = getExploration;
module.exports.getAuthRoom = getAuthRoom;
module.exports.getRoom = getRoom;
module.exports.getAuthGroup = getAuthGroup;
module.exports.getAuth = getAuth;