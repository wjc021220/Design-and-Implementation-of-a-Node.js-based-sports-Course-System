const mysql = require('mysql2/promise');
const config = require('../config/database');

// 获取系统日志列表
async function getSystemLogs(req, res) {
    try {
        const {
            page = 1,
            limit = 20,
            operation_type = '',
            operation_module = '',
            start_date = '',
            end_date = ''
        } = req.query;

        const connection = await mysql.createConnection(config);

        // 构建查询条件
        let whereClause = '1=1';
        const queryParams = [];

        if (operation_type) {
            whereClause += ' AND operation_type = ?';
            queryParams.push(operation_type);
        }

        if (operation_module) {
            whereClause += ' AND operation_module = ?';
            queryParams.push(operation_module);
        }

        if (start_date) {
            whereClause += ' AND created_at >= ?';
            queryParams.push(start_date);
        }

        if (end_date) {
            whereClause += ' AND created_at <= ?';
            queryParams.push(end_date);
        }

        // 获取总数
        const countQuery = `SELECT COUNT(*) as total FROM admin_operation_logs WHERE ${whereClause}`;
        const [countResult] = await connection.execute(countQuery, queryParams);
        const total = countResult[0].total;

        // 获取分页数据
        const offset = (page - 1) * limit;
        const dataQuery = `
            SELECT 
                aol.*,
                au.real_name as admin_name
            FROM admin_operation_logs aol
            LEFT JOIN admin_users au ON aol.admin_id = au.id
            WHERE ${whereClause}
            ORDER BY aol.created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [rows] = await connection.execute(dataQuery, [...queryParams, parseInt(limit), parseInt(offset)]);

        await connection.end();

        res.json({
            success: true,
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('获取系统日志失败:', error);
        res.status(500).json({
            success: false,
            message: '获取系统日志失败'
        });
    }
}

// 获取日志详情
async function getLogDetail(req, res) {
    try {
        const logId = req.params.id;
        const connection = await mysql.createConnection(config);

        const [rows] = await connection.execute(`
            SELECT 
                aol.*,
                au.real_name as admin_name
            FROM admin_operation_logs aol
            LEFT JOIN admin_users au ON aol.admin_id = au.id
            WHERE aol.id = ?
        `, [logId]);

        await connection.end();

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '日志不存在'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('获取日志详情失败:', error);
        res.status(500).json({
            success: false,
            message: '获取日志详情失败'
        });
    }
}

// 清理过期日志
async function cleanupOldLogs(req, res) {
    try {
        const { days = 90 } = req.body; // 默认清理90天前的日志

        const connection = await mysql.createConnection(config);

        // 删除指定天数之前的日志
        const [result] = await connection.execute(`
            DELETE FROM admin_operation_logs 
            WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [parseInt(days)]);

        await connection.end();

        // 记录清理操作
        const { logAdminOperation } = require('./adminAuthController');
        await logAdminOperation(
            req.user.id,
            'delete',
            'system_management',
            `清理${days}天前的系统日志，共清理${result.affectedRows}条记录`,
            { days, deleted_count: result.affectedRows },
            'success',
            req
        );

        res.json({
            success: true,
            message: `成功清理${result.affectedRows}条过期日志`
        });
    } catch (error) {
        console.error('清理过期日志失败:', error);
        res.status(500).json({
            success: false,
            message: '清理过期日志失败'
        });
    }
}

// 导出日志
async function exportLogs(req, res) {
    try {
        const {
            operation_type = '',
            operation_module = '',
            start_date = '',
            end_date = ''
        } = req.query;

        const connection = await mysql.createConnection(config);

        // 构建查询条件
        let whereClause = '1=1';
        const queryParams = [];

        if (operation_type) {
            whereClause += ' AND operation_type = ?';
            queryParams.push(operation_type);
        }

        if (operation_module) {
            whereClause += ' AND operation_module = ?';
            queryParams.push(operation_module);
        }

        if (start_date) {
            whereClause += ' AND created_at >= ?';
            queryParams.push(start_date);
        }

        if (end_date) {
            whereClause += ' AND created_at <= ?';
            queryParams.push(end_date);
        }

        // 限制导出数量，防止数据过大
        const dataQuery = `
            SELECT 
                aol.operation_type,
                aol.operation_module,
                aol.operation_description,
                au.real_name as admin_name,
                aol.ip_address,
                aol.user_agent,
                aol.result,
                aol.created_at
            FROM admin_operation_logs aol
            LEFT JOIN admin_users au ON aol.admin_id = au.id
            WHERE ${whereClause}
            ORDER BY aol.created_at DESC 
            LIMIT 10000
        `;
        const [rows] = await connection.execute(dataQuery, queryParams);

        await connection.end();

        // 记录导出操作
        const { logAdminOperation } = require('./adminAuthController');
        await logAdminOperation(
            req.user.id,
            'export',
            'system_management',
            `导出系统日志，共${rows.length}条记录`,
            { filters: req.query, count: rows.length },
            'success',
            req
        );

        // 设置响应头为CSV格式
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="system_logs.csv"');

        // 生成CSV内容
        let csv = '\uFEFF'; // BOM for UTF-8
        csv += '操作类型,操作模块,操作描述,操作者,IP地址,用户代理,结果,操作时间\n';
        
        rows.forEach(row => {
            csv += `"${row.operation_type}","${row.operation_module}","${row.operation_description}","${row.admin_name || ''}","${row.ip_address || ''}","${row.user_agent || ''}","${row.result}","${row.created_at}"\n`;
        });

        res.send(csv);
    } catch (error) {
        console.error('导出日志失败:', error);
        res.status(500).json({
            success: false,
            message: '导出日志失败'
        });
    }
}

// 获取日志统计信息
async function getLogStatistics(req, res) {
    try {
        const connection = await mysql.createConnection(config);

        // 获取各种统计数据
        const [totalCount] = await connection.execute('SELECT COUNT(*) as total FROM admin_operation_logs');
        
        const [todayCount] = await connection.execute(`
            SELECT COUNT(*) as count FROM admin_operation_logs 
            WHERE DATE(created_at) = CURDATE()
        `);

        const [operationTypes] = await connection.execute(`
            SELECT operation_type, COUNT(*) as count 
            FROM admin_operation_logs 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY operation_type
        `);

        const [operationModules] = await connection.execute(`
            SELECT operation_module, COUNT(*) as count 
            FROM admin_operation_logs 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY operation_module
        `);

        const [failedOperations] = await connection.execute(`
            SELECT COUNT(*) as count 
            FROM admin_operation_logs 
            WHERE result = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        await connection.end();

        res.json({
            success: true,
            data: {
                total: totalCount[0].total,
                today: todayCount[0].count,
                operationTypes: operationTypes,
                operationModules: operationModules,
                failedCount: failedOperations[0].count
            }
        });
    } catch (error) {
        console.error('获取日志统计失败:', error);
        res.status(500).json({
            success: false,
            message: '获取日志统计失败'
        });
    }
}

module.exports = {
    getSystemLogs,
    getLogDetail,
    cleanupOldLogs,
    exportLogs,
    getLogStatistics
};
