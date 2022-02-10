import ModeData from "./modeData.js"
export default class Room {
    constructor(id, name, description, image, visible, mode, entryCode, roomCode, mode_data = []) {
        this.id = id
        this.name = name
        this.description = description
        this.image = image
        this.visible = visible
        this.mode = mode
        this.entryCode = entryCode
        this.roomCode = roomCode
        this.mode_data = mode_data
    }

    addModeData(mode_data) {
        this.mode_data.push(mode_data)
    }

    static createRoom(element) {
        return new Room(
            element.id,
            element.name,
            element.description,
            element.image,
            element.visible,
            element.mode,
            element.entryCode === -1,
            element.roomCode
        )
    }

    static createFFARoom(element) {
        const room = Room.createRoom(element)
        room.entryCode = undefined
        room.addModeData(new ModeData(element.mode_participants))
        return room
    }

    static createGroupRoom(element) {
        const room = Room.createRoom(element)
        room.addModeData(ModeData.createFromElement(element))
        return room
    }
}