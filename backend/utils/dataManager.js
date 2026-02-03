/**
 * DATA MANAGER - Centralized Data Management System
 * 
 * Purpose: Prevent data conflicts between clubs
 * Key: Student ID is the unique identifier
 * 
 * Rules:
 * 1. Student ID is unique across entire system
 * 2. A member can be in multiple clubs
 * 3. Member data is synchronized with club data
 * 4. All operations go through this manager
 */

const fs = require('fs');
const path = require('path');

// ========== FILE PATHS ==========
const DATA_PATHS = {
    members: path.join(__dirname, '../members.json'),
    clubs: path.join(__dirname, '../clubs'),
    events: path.join(__dirname, '../events.json'),
    announcements: path.join(__dirname, '../announcements.json'),
    attendance: path.join(__dirname, '../attendance.json')
};

// ========== CORE DATA OPERATIONS ==========

/**
 * Load all members from members.json
 */
function loadMembers() {
    try {
        if (fs.existsSync(DATA_PATHS.members)) {
            const data = fs.readFileSync(DATA_PATHS.members, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('❌ Error loading members:', error);
        return [];
    }
}

/**
 * Save members to members.json
 */
function saveMembers(members) {
    try {
        fs.writeFileSync(DATA_PATHS.members, JSON.stringify(members, null, 2), 'utf8');
        console.log('✅ Members saved successfully');
        return true;
    } catch (error) {
        console.error('❌ Error saving members:', error);
        return false;
    }
}

/**
 * Load all clubs from clubs folder
 */
function loadClubs() {
    try {
        const clubs = [];
        
        if (!fs.existsSync(DATA_PATHS.clubs)) {
            fs.mkdirSync(DATA_PATHS.clubs, { recursive: true });
            return [];
        }
        
        const files = fs.readdirSync(DATA_PATHS.clubs);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(DATA_PATHS.clubs, file);
                const data = fs.readFileSync(filePath, 'utf8');
                const club = JSON.parse(data);
                clubs.push(club);
            }
        }
        
        clubs.sort((a, b) => a.id - b.id);
        return clubs;
    } catch (error) {
        console.error('❌ Error loading clubs:', error);
        return [];
    }
}

/**
 * Save a single club to its JSON file
 */
function saveClub(club) {
    try {
        const filename = club.name.toLowerCase().replace(/\s+/g, '_') + '.json';
        const filePath = path.join(DATA_PATHS.clubs, filename);
        
        if (!fs.existsSync(DATA_PATHS.clubs)) {
            fs.mkdirSync(DATA_PATHS.clubs, { recursive: true });
        }
        
        fs.writeFileSync(filePath, JSON.stringify(club, null, 2), 'utf8');
        console.log(`✅ Club "${club.name}" saved successfully`);
        return true;
    } catch (error) {
        console.error('❌ Error saving club:', error);
        return false;
    }
}

// ========== STUDENT ID-BASED OPERATIONS ==========

/**
 * Find member by Student ID (Primary Key)
 * @param {string} studentId - Student ID
 * @returns {object|null} Member object or null
 */
function findMemberByStudentId(studentId) {
    const members = loadMembers();
    const member = members.find(m => m.studentId === studentId);
    
    if (member) {
        console.log(`✅ Found member: ${member.username} (${studentId})`);
    } else {
        console.log(`❌ No member found with Student ID: ${studentId}`);
    }
    
    return member || null;
}

/**
 * Find member by ID (Secondary lookup)
 */
function findMemberById(memberId) {
    const members = loadMembers();
    return members.find(m => m.id === memberId) || null;
}

/**
 * Find member by username
 */
function findMemberByUsername(username) {
    const members = loadMembers();
    return members.find(m => m.username === username) || null;
}

/**
 * Check if Student ID exists in system
 */
function studentIdExists(studentId) {
    const member = findMemberByStudentId(studentId);
    return member !== null;
}

// ========== CLUB MEMBERSHIP OPERATIONS ==========

/**
 * Add member to club (CONFLICT-FREE + DETAILED TRACKING)
 * This is the MAIN function to add members to clubs
 * ONLY CLUB OWNERS CAN USE THIS - Members cannot self-join
 * 
 * @param {string} studentId - Student ID of member
 * @param {number} clubId - Club ID
 * @param {string} addedBy - Username of owner who added (optional)
 * @returns {object} Result {success: boolean, message: string, member: object}
 */
function addMemberToClub(studentId, clubId, addedBy = 'owner') {
    console.log(`\n🔄 Adding member ${studentId} to club ${clubId} by ${addedBy}...`);
    
    // Step 1: Find member by Student ID
    const members = loadMembers();
    const member = members.find(m => m.studentId === studentId);
    
    if (!member) {
        console.log(`❌ Student ID ${studentId} not found in system`);
        return {
            success: false,
            message: `Student ID ${studentId} does not exist. Member must register first.`,
            member: null
        };
    }
    
    // Step 2: Find club
    const clubs = loadClubs();
    const club = clubs.find(c => c.id === clubId);
    
    if (!club) {
        console.log(`❌ Club ID ${clubId} not found`);
        return {
            success: false,
            message: `Club ID ${clubId} does not exist.`,
            member: null
        };
    }
    
    // Step 3: Check if already in club
    if (club.members && club.members.includes(member.id)) {
        console.log(`⚠️ Member ${member.username} already in club ${club.name}`);
        return {
            success: true,
            message: `${member.username} is already a member of ${club.name}`,
            member: member
        };
    }
    
    // Step 4: Add to club's members array
    if (!club.members) {
        club.members = [];
    }
    club.members.push(member.id);
    club.totalMembers = club.members.length;
    
    // Step 4.5: Add detailed tracking (NEW - Better Organization)
    if (!club.memberDetails) {
        club.memberDetails = [];
    }
    club.memberDetails.push({
        memberId: member.id,
        studentId: member.studentId,
        username: member.username,
        email: member.email,
        addedBy: addedBy,
        addedOn: new Date().toISOString(),
        role: 'member',
        status: 'active'
    });
    
    // Step 5: Add club to member's clubs array (SIMPLIFIED)
    if (!member.clubs) {
        member.clubs = [];
    }
    if (!member.clubs.includes(clubId)) {
        member.clubs.push(clubId);
    }
    
    // Update member status
    member.status = 'assigned';
    
    // Set active club if this is first club
    if (!member.activeClub) {
        member.activeClub = clubId;
    }
    
    // Step 6: Save both
    saveClub(club);
    saveMembers(members);
    
    console.log(`✅ ${member.username} (${studentId}) added to ${club.name} by ${addedBy}`);
    console.log(`   📋 Total members in ${club.name}: ${club.totalMembers}`);
    
    return {
        success: true,
        message: `${member.username} added to ${club.name} successfully!`,
        member: member,
        clubName: club.name
    };
}

/**
 * Remove member from club (SAFE)
 * 
 * @param {string} studentId - Student ID of member
 * @param {number} clubId - Club ID
 * @returns {object} Result {success: boolean, message: string}
 */
function removeMemberFromClub(studentId, clubId) {
    console.log(`\n🔄 Removing member ${studentId} from club ${clubId}...`);
    
    const members = loadMembers();
    const member = members.find(m => m.studentId === studentId);
    
    if (!member) {
        return {
            success: false,
            message: `Student ID ${studentId} not found`
        };
    }
    
    const clubs = loadClubs();
    const club = clubs.find(c => c.id === clubId);
    
    if (!club) {
        return {
            success: false,
            message: `Club ID ${clubId} not found`
        };
    }
    
    // Remove from club's members array
    if (club.members) {
        club.members = club.members.filter(id => id !== member.id);
        club.totalMembers = club.members.length;
        // Also remove from detailed member list if present
        if (Array.isArray(club.memberDetails)) {
            club.memberDetails = club.memberDetails.filter(d => d.memberId !== member.id);
        }
        saveClub(club);
    }
    
    // Remove from member's clubs array (SIMPLIFIED)
    if (member.clubs) {
        member.clubs = member.clubs.filter(id => id !== clubId);
    }
    
    // Update status if no clubs left
    if (!member.clubs || member.clubs.length === 0) {
        member.status = 'unassigned';
    }
    
    // Clear active club if it was this club
    if (member.activeClub === clubId) {
        member.activeClub = member.clubs && member.clubs.length > 0 ? member.clubs[0] : null;
    }
    
    saveMembers(members);
    
    console.log(`✅ ${member.username} removed from ${club.name}`);
    
    return {
        success: true,
        message: `${member.username} removed from ${club.name}`
    };
}

/**
 * Get all members of a specific club (FILTERED BY CLUB)
 * This ensures ONLY members that belong to this club are returned
 * 
 * @param {number} clubId - Club ID
 * @returns {array} Array of members in this club
 */
function getClubMembers(clubId) {
    console.log(`\n🔍 Getting members for club ID: ${clubId}`);
    
    const clubs = loadClubs();
    const club = clubs.find(c => c.id === clubId);
    
    if (!club) {
        console.log(`❌ Club ${clubId} not found`);
        return [];
    }
    
    const members = loadMembers();
    const clubMemberIds = club.members || [];
    
    // IMPORTANT: Only return members whose ID is in club.members array
    const clubMembers = members.filter(m => clubMemberIds.includes(m.id));
    
    console.log(`✅ Found ${clubMembers.length} members in ${club.name}:`);
    clubMembers.forEach(m => {
        console.log(`   - ${m.username} (${m.studentId})`);
    });
    
    return clubMembers;
}

/**
 * Get all clubs a member belongs to (SIMPLIFIED)
 * 
 * @param {string} studentId - Student ID
 * @returns {array} Array of clubs member belongs to
 */
function getMemberClubs(studentId) {
    const member = findMemberByStudentId(studentId);
    if (!member) {
        return [];
    }
    
    const clubs = loadClubs();
    const memberClubs = member.clubs || [];
    
    return clubs.filter(c => memberClubs.includes(c.id));
}

/**
 * Get all unassigned members (SIMPLIFIED)
 * Members not in any club
 * 
 * @returns {array} Array of unassigned members
 */
function getUnassignedMembers() {
    const members = loadMembers();
    
    const unassignedMembers = members.filter(m => {
        const clubs = m.clubs || [];
        return clubs.length === 0 && m.role === 'member';
    });
    
    console.log(`📋 Found ${unassignedMembers.length} unassigned members`);
    
    return unassignedMembers.map(m => ({
        id: m.id,
        username: m.username,
        studentId: m.studentId,
        email: m.email,
        status: m.status || 'unassigned'
    }));
}

// ========== DATA VALIDATION & SYNC ==========

/**
 * Validate and sync data integrity
 * Ensures club.members and member.clubIds are in sync
 * 
 * @returns {object} Validation report
 */
function validateAndSyncData() {
    console.log('\n🔍 Starting data validation and sync...\n');
    
    const members = loadMembers();
    const clubs = loadClubs();
    
    let fixed = 0;
    let errors = [];
    
    // Check 1: Validate club members exist
    clubs.forEach(club => {
        if (!club.members) {
            club.members = [];
        }
        
        const validMembers = [];
        club.members.forEach(memberId => {
            const member = members.find(m => m.id === memberId);
            if (member) {
                validMembers.push(memberId);
                
                // Ensure member has this club in clubs array (SIMPLIFIED)
                if (!member.clubs) {
                    member.clubs = [];
                }
                if (!member.clubs.includes(club.id)) {
                    member.clubs.push(club.id);
                    fixed++;
                    console.log(`✅ Added club ${club.name} to ${member.username}'s clubs`);
                }
            } else {
                errors.push(`Club "${club.name}" has non-existent member ID: ${memberId}`);
                fixed++;
            }
        });
        
        club.members = validMembers;
        club.totalMembers = validMembers.length;
    });
    
    // Check 2: Validate member clubs exist (SIMPLIFIED)
    members.forEach(member => {
        if (!member.clubs) {
            member.clubs = [];
        }
        
        const validClubs = [];
        member.clubs.forEach(clubId => {
            const club = clubs.find(c => c.id === clubId);
            if (club) {
                validClubs.push(clubId);
                
                // Ensure club has this member
                if (!club.members) {
                    club.members = [];
                }
                if (!club.members.includes(member.id)) {
                    club.members.push(member.id);
                    club.totalMembers = club.members.length;
                    fixed++;
                    console.log(`✅ Added ${member.username} to club ${club.name}'s members`);
                }
            } else {
                errors.push(`Member "${member.username}" has non-existent club ID: ${clubId}`);
                fixed++;
            }
        });
        
        member.clubs = validClubs;
        
        // Update status
        if (validClubs.length === 0) {
            member.status = 'unassigned';
        } else {
            member.status = 'assigned';
        }
        
        // Fix active club
        if (member.activeClub && !validClubs.includes(member.activeClub)) {
            member.activeClub = validClubs.length > 0 ? validClubs[0] : null;
            fixed++;
        }
    });
    
    // Save all
    saveMembers(members);
    clubs.forEach(club => saveClub(club));
    
    console.log('\n✅ Data validation complete!');
    console.log(`   - Fixed ${fixed} issues`);
    console.log(`   - Found ${errors.length} errors\n`);
    
    if (errors.length > 0) {
        console.log('Errors found:');
        errors.forEach(err => console.log(`   ⚠️ ${err}`));
    }
    
    return {
        success: true,
        fixed: fixed,
        errors: errors
    };
}

/**
 * Get system statistics
 */
function getSystemStats() {
    const members = loadMembers();
    const clubs = loadClubs();
    
    return {
        totalMembers: members.length,
        totalClubs: clubs.length,
        clubStats: clubs.map(club => ({
            id: club.id,
            name: club.name,
            memberCount: club.members ? club.members.length : 0,
            members: club.members || []
        })),
        memberStats: members.map(member => ({
            id: member.id,
            username: member.username,
            studentId: member.studentId,
            clubCount: member.clubs ? member.clubs.length : 0,
            clubs: member.clubs || [],
            status: member.status || 'unassigned'
        }))
    };
}

// ========== EXPORTS ==========

module.exports = {
    // Core operations
    loadMembers,
    saveMembers,
    loadClubs,
    saveClub,
    
    // Student ID operations
    findMemberByStudentId,
    findMemberById,
    findMemberByUsername,
    studentIdExists,
    
    // Club membership
    addMemberToClub,
    removeMemberFromClub,
    getClubMembers,
    getMemberClubs,
    getUnassignedMembers,
    
    // Validation
    validateAndSyncData,
    getSystemStats,
    
    // Paths
    DATA_PATHS
};

